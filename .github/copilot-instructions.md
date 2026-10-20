# HashPanel AI Coding Instructions

Expert guide for AI agents working on HashPanel - a Mastodon hashtag monitoring
and analytics system.

## 🏗️ Architecture & Core Concepts
- **Tech Stack**: Python 3.11+ (ESM-style package layout), FastAPI, SQLite (`sqlite3` stdlib), [Mastodon.py](https://github.com/halcy/Mastodon.py), Pillow.
- **Service-Oriented Logic**: Business logic resides in `src/hashpanel/services/`.
  - `mastodon.py`: All communication with the Mastodon API via `Mastodon.py`. Normalizes errors, enforces the minimum delay between calls, tracks rate-limit headers.
  - `collector.py`: Orchestrates data collection from Mastodon to SQLite.
  - `hashtags.py`: Hashtag analysis (posts, metrics, trending tags).
  - `relevance.py`: Relevance scoring. `processor.py`: toot processing pipeline.
  - `images.py`: Dashboard PNG generation with accessible ALT text.
  - `listener.py`: Mention bot over the Mastodon streaming WebSocket.
- **Data Flow**: CLI/Cron -> `collector` -> `mastodon` -> API -> SQLite. Web Dashboard -> FastAPI Routes -> `hashtags`/`collector`.
- **Hashtag Mapping**: Defined by day of week in `src/hashpanel/constants.py` (`HASHTAGS`). Use `get_hashtags_for_day()` to handle string vs list formats.
- **Relevance Algorithm**: `src/hashpanel/services/relevance.py` calculates a 0-100 score.
  - **Metrics**: Favorites (35%), Boosts (25%), Followers (25%), Replies (15%).
  - **Scaling**: Uses `log10` scaling for raw metrics and a sigmoid-like function for the 0-100 normalization:
    `normalized = 100 * (1 - exp(-rawScore / MAX_EXPECTED_SCORE))`
  - **Key Const**: `MAX_EXPECTED_SCORE = 2.5` controls how quickly scores approach 100.
- **Data Processing Pipeline**: `src/hashpanel/services/processor.py` orchestrates toot filtering and sorting.
  - **Pipeline Steps**: 1. Filter valid structure -> 2. Remove `IGNORED_ACCOUNTS` -> 3. Calculate relevance -> 4. Sort -> 5. Date/timeframe filtering.
  - **Timezones**: Uses `zoneinfo` (defaulting to `America/Sao_Paulo`). Filtering supports dynamic client timezones if provided.

## 🛠️ Critical Workflows
- **Running the App**:
  - Web Server: `hashpanel-server` (or `uvicorn hashpanel.server.app:app`).
  - CLI: `hashpanel` (also `hashpanel status`, `hashpanel analyze <tag>`, `hashpanel report`).
  - Data Collection: `hashpanel-collect` (also `--date`, `--range`, `--last-7-days`).
- **Database**:
  - Migrations: run automatically on first connection; `python -c "from hashpanel.database.connection import get_database; get_database()"`.
  - Reset: delete `data/hashpanel.db`.
- **Testing**: `pytest`.

## 📏 Project Conventions
- **Error Handling**: Use custom errors from `src/hashpanel/errors.py`. Wrap calls to the Mastodon API carefully to prevent network errors from crashing the process.
- **Logging**: Use the structured logger from `src/hashpanel/utils/logger.py` (e.g. `logger.info("event", data=...)`).
- **Timezones**: Always use `zoneinfo` with `America/Sao_Paulo` (configured in `src/hashpanel/config.py`).
- **Blocking I/O**: `Mastodon.py` is synchronous. In async route handlers, use the `*_async` wrappers (which use `asyncio.to_thread`) instead of calling the service directly.
- **CORS**: In production, `CORS_ORIGIN` is MANDATORY in `.env`.

## 📍 Key Files
- `src/hashpanel/config.py`: Configuration, validated with pydantic-settings.
- `src/hashpanel/constants.py`: Configuration, hashtags per day, and rate limit settings.
- `src/hashpanel/database/connection.py`: SQLite connection management (WAL mode enabled).
- `src/hashpanel/services/mastodon.py`: The "brain" of external integrations.
- `src/hashpanel/server/app.py`: FastAPI application, middleware chain.
- `src/hashpanel/cli/main.py`: CLI entry point.

## ⚠️ Important Considerations
- **Rate Limiting**: Respect `RATE_LIMIT_DELAY_MS` when calling Mastodon.
- **Mastodon.py base URL**: `api_base_url` must be the *instance root* (e.g. `https://example.com`), not the `/api/v1` path — the library appends the API path itself. `config.py` normalizes this.
- **Mastodon.py version check**: Keep `version_check_mode="none"`. With auto-detection, the library recurses infinitely when the instance endpoint is unreachable.
- **SQLite transactions**: The connection uses `isolation_level=None` (autocommit). Without it, writes are silently rolled back when the connection closes.
- **Uncaught Exceptions**: The server handles network timeouts gracefully to avoid crashing in containerized environments.
