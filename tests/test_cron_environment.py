"""Testes do ambiente entregue ao cron do container.

O daemon do cron não herda o ambiente do container, e o ``.env`` não entra na
imagem (``.dockerignore``). Por isso o ``docker-entrypoint.sh`` grava os
exports necessários em ``data/.cron-env`` (modo 600) e o
``scripts/cron-collect-history.sh`` carrega esse arquivo antes de coletar.

Estes testes executam os scripts reais em um sandbox (``tmp_path``), com
``python``/``crontab``/``cron``/``hashpanel-collect`` substituídos por stubs
que registram o que receberam. Sem Docker e sem rede.
"""

from __future__ import annotations

import os
import shutil
import stat
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
ENTRYPOINT = REPO_ROOT / "docker-entrypoint.sh"
CRON_SCRIPT = REPO_ROOT / "scripts" / "cron-collect-history.sh"
SH = shutil.which("sh") or "/bin/sh"
BASH = shutil.which("bash") or "/bin/bash"

# PATH mínimo: stubs + utilitários reais (mkdir, sed, date, chmod...).
BASE_PATH = os.defpath


def _write_stub(directory: Path, name: str, body: str) -> None:
    """Cria um executável de mentira no diretório de stubs."""
    path = directory / name
    path.write_text("#!/bin/sh\n" + body, encoding="utf-8")
    path.chmod(0o755)


def _sandbox_env(stub_dir: Path, **values: str) -> dict[str, str]:
    """Ambiente isolado: só o necessário, sem herdar o env do pytest."""
    env = {
        "PATH": os.pathsep.join([str(stub_dir), BASE_PATH]),
        "HOME": str(stub_dir.parent),
        "TMPDIR": str(stub_dir.parent),
    }
    env.update({key: value for key, value in values.items() if value is not None})
    return env


def _run(args: list[str], env: dict[str, str], cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        env=env,
        cwd=cwd,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )


def _parse_env_dump(path: Path) -> dict[str, str]:
    """Interpreta a saída de ``env`` gravada por um stub."""
    result: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        key, _, value = line.partition("=")
        result[key] = value
    return result


def _prepare_entrypoint_sandbox(tmp_path: Path) -> tuple[Path, Path, Path, Path]:
    """Monta um ``/app`` falso e os stubs do entrypoint.

    Devolve (app_dir, stub_dir, crontab_record, env_file).
    """
    app_dir = tmp_path / "app"
    (app_dir / "scripts").mkdir(parents=True)
    shutil.copy2(CRON_SCRIPT, app_dir / "scripts" / "cron-collect-history.sh")

    stub_dir = tmp_path / "stubs"
    stub_dir.mkdir()
    crontab_record = tmp_path / "crontab.record"
    # `crontab -l` só lista; `crontab arquivo` instala (aqui só registramos).
    _write_stub(
        stub_dir,
        "crontab",
        f'case "$1" in -l) exit 0 ;; esac\ncp "$1" "{crontab_record}"\n',
    )
    # Não deixar o daemon real subir no sandbox.
    _write_stub(stub_dir, "cron", "exit 0\n")
    _write_stub(stub_dir, "python", "exit 0\n")

    env_file = app_dir / "data" / ".cron-env"
    return app_dir, stub_dir, crontab_record, env_file


def test_entrypoint_writes_cron_env_file(tmp_path: Path) -> None:
    """O entrypoint persiste o ambiente em modo 600, sem vazar segredos.

    O valor do segredo contém aspa simples e ``$(...)``: se o quoting
    estivesse errado, o arquivo executaria o comando ao ser carregado.
    """
    app_dir, stub_dir, crontab_record, env_file = _prepare_entrypoint_sandbox(tmp_path)
    pwned = tmp_path / "pwned"

    secret = f"s3cr'3t $(touch {pwned})"
    db_path = str(tmp_path / "data" / "hashpanel.db")
    env = _sandbox_env(
        stub_dir,
        HASHPANEL_APP_DIR=str(app_dir),
        HASHPANEL_DATA_DIR=str(app_dir / "data"),
        HASHPANEL_LOG_DIR=str(app_dir / "logs"),
        HASHPANEL_CRON_ENV_FILE=str(env_file),
        HASHPANEL_CRON_TAB=str(tmp_path / "crontab.txt"),
        CRON_SCHEDULE="30 4 * * *",
        MASTODON_URL="https://mastodon.social",
        CLIENT_KEY="client-key-123",
        CLIENT_SECRET=secret,
        ACCESS_TOKEN="token-abc",
        PREFERRED_TIMEZONE="America/Sao_Paulo",
        RATE_LIMIT_DELAY_MS="1500",
        MAX_API_PAGES="7",
        TOOTS_PER_PAGE="40",
        API_TIMEOUT_MS="30000",
        DB_PATH=db_path,
        LOG_LEVEL="info",
        SERVER_PUBLIC_URL="https://painel.example",
        CORS_ORIGIN="",
    )

    result = _run([SH, str(ENTRYPOINT), "true"], env, app_dir)

    assert result.returncode == 0, result.stderr
    assert env_file.is_file(), "o cron não tem como receber o ambiente"
    assert stat.S_IMODE(env_file.stat().st_mode) == 0o600

    content = env_file.read_text(encoding="utf-8")
    exported = {
        line.split("=", 1)[0].removeprefix("export ")
        for line in content.splitlines()
        if line.startswith("export ")
    }
    # O conjunto completo exportado — nenhuma variável do CRON_ENV_VARS pode
    # sumir sem o teste perceber (SERVER_PUBLIC_URL, por exemplo, é o que
    # evita relatórios noturnos apontando para http://localhost:3000).
    assert exported == {
        "MASTODON_URL",
        "CLIENT_KEY",
        "CLIENT_SECRET",
        "ACCESS_TOKEN",
        "PREFERRED_TIMEZONE",
        "RATE_LIMIT_DELAY_MS",
        "MAX_API_PAGES",
        "TOOTS_PER_PAGE",
        "API_TIMEOUT_MS",
        "DB_PATH",
        "LOG_LEVEL",
        "SERVER_PUBLIC_URL",
    }
    assert "CORS_ORIGIN" not in exported

    # Carregar o arquivo em um shell deve devolver os valores exatos.
    loaded = _run(
        [
            SH,
            "-c",
            '. "$HASHPANEL_CRON_ENV_FILE"; '
            'printf "%s\\n" "$MASTODON_URL" "$CLIENT_KEY" "$CLIENT_SECRET" '
            '"$ACCESS_TOKEN" "$PREFERRED_TIMEZONE" "$RATE_LIMIT_DELAY_MS" '
            '"$MAX_API_PAGES" "$TOOTS_PER_PAGE" "$API_TIMEOUT_MS" "$DB_PATH" '
            '"$LOG_LEVEL" "$SERVER_PUBLIC_URL"',
        ],
        _sandbox_env(stub_dir, HASHPANEL_CRON_ENV_FILE=str(env_file)),
        tmp_path,
    )
    assert loaded.returncode == 0, loaded.stderr
    assert loaded.stdout.splitlines() == [
        "https://mastodon.social",
        "client-key-123",
        secret,
        "token-abc",
        "America/Sao_Paulo",
        "1500",
        "7",
        "40",
        "30000",
        db_path,
        "info",
        "https://painel.example",
    ]
    assert not pwned.exists(), "o valor foi interpretado pelo shell ao ser carregado"

    # O crontab recebe o agendamento e o script, mas nunca os segredos.
    crontab_text = crontab_record.read_text(encoding="utf-8")
    assert "30 4 * * *" in crontab_text
    assert str(app_dir / "scripts" / "cron-collect-history.sh") in crontab_text
    assert "token-abc" not in crontab_text
    assert "client-key-123" not in crontab_text
    assert "token-abc" not in result.stdout + result.stderr
    assert "client-key-123" not in result.stdout + result.stderr


def test_entrypoint_survives_unwritable_env_file(tmp_path: Path) -> None:
    """Falha ao gravar o arquivo de ambiente só gera aviso, não aborta."""
    app_dir, stub_dir, crontab_record, _ = _prepare_entrypoint_sandbox(tmp_path)

    blocker = tmp_path / "blocker"
    blocker.write_text("não é um diretório", encoding="utf-8")

    env = _sandbox_env(
        stub_dir,
        HASHPANEL_APP_DIR=str(app_dir),
        HASHPANEL_DATA_DIR=str(app_dir / "data"),
        HASHPANEL_LOG_DIR=str(app_dir / "logs"),
        HASHPANEL_CRON_ENV_FILE=str(blocker / ".cron-env"),
        HASHPANEL_CRON_TAB=str(tmp_path / "crontab.txt"),
        MASTODON_URL="https://mastodon.social",
    )

    result = _run([SH, str(ENTRYPOINT), "true"], env, app_dir)

    assert result.returncode == 0, result.stderr
    assert "Warning: could not write cron environment file" in result.stderr
    # O entrypoint seguiu adiante e instalou o crontab.
    assert crontab_record.is_file()


def _prepare_collect_sandbox(tmp_path: Path) -> tuple[Path, Path, Path, Path]:
    """Projeto falso com o script de coleta e stubs que gravam o ambiente."""
    project = tmp_path / "project"
    (project / "scripts").mkdir(parents=True)
    (project / "data").mkdir()
    shutil.copy2(CRON_SCRIPT, project / "scripts" / "cron-collect-history.sh")

    stub_dir = tmp_path / "stubs"
    stub_dir.mkdir()
    collect_record = tmp_path / "collect.env"
    collect_args = tmp_path / "collect.args"
    report_record = tmp_path / "report.env"
    report_args = tmp_path / "report.args"

    _write_stub(
        stub_dir,
        "hashpanel-collect",
        f'env > "{collect_record}"\nprintf "%s\\n" "$*" > "{collect_args}"\nexit 0\n',
    )
    _write_stub(
        stub_dir,
        "hashpanel",
        f'env > "{report_record}"\nprintf "%s\\n" "$*" > "{report_args}"\nexit 0\n',
    )
    return project, stub_dir, collect_record, collect_args


def test_cron_script_loads_env_written_by_entrypoint(tmp_path: Path) -> None:
    """A coleta recebe as credenciais do arquivo persistido pelo entrypoint."""
    project, stub_dir, collect_record, _ = _prepare_collect_sandbox(tmp_path)
    env_file = project / "data" / ".cron-env"
    env_file.write_text(
        "export MASTODON_URL='https://mastodon.example'\n"
        "export CLIENT_SECRET='s3cr3t-do-cron'\n"
        "export DB_PATH='/var/lib/hashpanel.db'\n",
        encoding="utf-8",
    )
    env_file.chmod(0o600)

    env = _sandbox_env(
        stub_dir,
        HASHPANEL_CRON_ENV_FILE=str(env_file),
    )
    result = _run([BASH, str(project / "scripts" / "cron-collect-history.sh")], env, tmp_path)

    assert result.returncode == 0, result.stderr
    assert collect_record.is_file(), "hashpanel-collect não foi executado"
    received = _parse_env_dump(collect_record)
    assert received["MASTODON_URL"] == "https://mastodon.example"
    assert received["CLIENT_SECRET"] == "s3cr3t-do-cron"
    assert received["DB_PATH"] == "/var/lib/hashpanel.db"
    # Sem MASTODON_URL a coleta falharia todo dia — era exatamente o bug.


def test_cron_script_keeps_dotenv_fallback_with_crlf(tmp_path: Path) -> None:
    """Fora do container, o .env continua funcionando e o CRLF é removido."""
    project, stub_dir, collect_record, _ = _prepare_collect_sandbox(tmp_path)
    (project / ".env").write_bytes(
        b"# comentario\r\nMASTODON_URL=https://from-dotenv\r\nCLIENT_KEY=key-from-dotenv\r\n"
    )

    env = _sandbox_env(
        stub_dir,
        HASHPANEL_CRON_ENV_FILE=str(project / "data" / ".cron-env-missing"),
    )
    result = _run([BASH, str(project / "scripts" / "cron-collect-history.sh")], env, tmp_path)

    assert result.returncode == 0, result.stderr
    received = _parse_env_dump(collect_record)
    assert received["MASTODON_URL"] == "https://from-dotenv"
    assert received["CLIENT_KEY"] == "key-from-dotenv"


def test_cron_script_generates_report_after_collection(tmp_path: Path) -> None:
    """O relatório do dia continua sendo gerado depois da coleta."""
    project, stub_dir, _, _ = _prepare_collect_sandbox(tmp_path)
    env_file = project / "data" / ".cron-env"
    env_file.write_text("export MASTODON_URL='https://mastodon.example'\n", encoding="utf-8")

    env = _sandbox_env(stub_dir, HASHPANEL_CRON_ENV_FILE=str(env_file))
    result = _run([BASH, str(project / "scripts" / "cron-collect-history.sh")], env, tmp_path)

    assert result.returncode == 0, result.stderr
    report_args = (tmp_path / "report.args").read_text(encoding="utf-8").strip()
    assert report_args == "report --light"


def test_default_cron_env_path_matches_between_entrypoint_and_script(tmp_path: Path) -> None:
    """Sem variáveis de override, os dois lados usam o MESMO caminho padrão.

    O entrypoint grava em ``$APP_DIR/data/.cron-env`` e o script lê
    ``$PROJECT_DIR/data/.cron-env`` a partir da pasta onde ele mesmo está.
    Os testes anteriores fixam ``HASHPANEL_CRON_ENV_FILE`` à mão, então um
    desencontro entre os padrões passaria despercebido — e o cron rodaria
    sem credenciais em produção.
    """
    app_dir, stub_dir, _, _ = _prepare_entrypoint_sandbox(tmp_path)

    collect_record = tmp_path / "collect.env"
    _write_stub(stub_dir, "hashpanel-collect", f'env > "{collect_record}"\nexit 0\n')
    _write_stub(stub_dir, "hashpanel", "exit 0\n")

    # O entrypoint recebe as credenciais; o cron NÃO — como no container, ele
    # só pode obtê-las pelo arquivo que o entrypoint gravou. Só o
    # HASHPANEL_APP_DIR é comum aos dois passos, e nenhum dos dois recebe
    # HASHPANEL_CRON_ENV_FILE ou HASHPANEL_DATA_DIR.
    shared = {"HASHPANEL_APP_DIR": str(app_dir)}
    entrypoint_values = {
        **shared,
        "HASHPANEL_CRON_TAB": str(tmp_path / "crontab.txt"),
        "MASTODON_URL": "https://mastodon.example",
        "CLIENT_KEY": "client-key-123",
        "CLIENT_SECRET": "client-secret-456",
        "ACCESS_TOKEN": "token-abc",
        "SERVER_PUBLIC_URL": "https://painel.example",
    }

    entrypoint_result = _run(
        [SH, str(ENTRYPOINT), "true"],
        _sandbox_env(stub_dir, **entrypoint_values),
        app_dir,
    )

    assert entrypoint_result.returncode == 0, entrypoint_result.stderr
    default_env_file = app_dir / "data" / ".cron-env"
    assert default_env_file.is_file(), "o entrypoint não gravou no caminho padrão"

    cron_result = _run(
        [BASH, str(app_dir / "scripts" / "cron-collect-history.sh")],
        _sandbox_env(stub_dir, **shared),
        app_dir,
    )

    assert cron_result.returncode == 0, cron_result.stderr
    assert collect_record.is_file(), "hashpanel-collect não foi executado"
    received = _parse_env_dump(collect_record)
    assert received["MASTODON_URL"] == "https://mastodon.example"
    assert received["CLIENT_KEY"] == "client-key-123"
    assert received["CLIENT_SECRET"] == "client-secret-456"
    assert received["ACCESS_TOKEN"] == "token-abc"
    # Sem esta, todo relatório noturno apontaria para localhost.
    assert received["SERVER_PUBLIC_URL"] == "https://painel.example"
