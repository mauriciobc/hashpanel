import { HASHTAGS, TOOTS_PER_PAGE, getFirstHashtagForDay } from './constants.js';
import { PREFERRED_TIMEZONE } from './config.js';
import { fetchTootsFromAPI, getTrendingTags } from './api.js';
import { sortTootsByRelevance, removeIgnoredToots, filterTootsByDate } from './utils.js';
import { generateTootText } from './generateTootText.js';
import readline from 'readline';
import moment from'moment-timezone';

async function main() {
  const hashtagEntry = HASHTAGS[new Date().getDay()];
  const hashtag = getFirstHashtagForDay(hashtagEntry);
  const currentDate = moment().tz(PREFERRED_TIMEZONE).format('YYYY-MM-DD');
  const toots = await fetchToots(hashtag);
  const sortedToots = await sortTootsByRelevance(toots);
  const allowedToots = await removeIgnoredToots(sortedToots);
  const todaysToots = await filterTootsByDate(allowedToots, currentDate);
  
  if (todaysToots.length === 0) {
    console.log('Nenhum post encontrado para hoje. Encerrando.');
    return;
  }
  
  const tootText = await generateTootText(hashtag, todaysToots);
  const trendingTags = await getTrendingTags();
  console.log('Trending tags:', trendingTags);
  console.log(tootText);

  const answer = await new Promise(resolve => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    rl.question('Quer publicar o post? (s/n) ', answer => {
      rl.close();
      resolve(answer);
    });
  });

  if (answer.toLowerCase() === 's') {
    console.log(tootText);
    await createToot(tootText);
  }
}

async function fetchToots(hashtag) {
  try {
    let toots = [];
    let maxId = null;
    console.log(`Obtendo posts para ${hashtag}...`);

    while (true) {
      const params = {
        tag: hashtag,
        limit: TOOTS_PER_PAGE,
      };
      if (maxId) {
        params.max_id = maxId;
      }

      const response = await fetchTootsFromAPI(hashtag, params);
      if (!Array.isArray(response.data)) {
        console.error('Erro ao obter posts:', response);
        break;
      }

      const newToots = response.data;
      toots.push(...newToots);

      maxId = newToots[newToots.length - 1]?.id;

      if (newToots.length === 0 || newToots.length < TOOTS_PER_PAGE) {
        break;
      }
    }

    console.log(`Posts obtidos: ${toots.length}`);
    return toots;
  } catch (error) {
    console.error('Erro ao obter posts:', error);
    throw error;
  }
}

async function createToot(tootText) {
  if (!process.env.MASTODON_URL || !process.env.ACCESS_TOKEN) {
    throw new Error("Variáveis de ambiente MASTODON_URL e ACCESS_TOKEN não configuradas");
  }

  console.log('Preparando para criar post...');
  console.log('Texto do post:', tootText.slice(0, 50) + '...', `(${tootText.length} caracteres)`);

  if (typeof tootText!=='string') {
    throw new Error('O texto do post deve ser uma string');
  }

  if (tootText.trim() === '') {
    throw new Error('O texto do post não pode estar vazio');
  }

  try {
    console.log('Criando post...');
    const response = await fetch(`${process.env.MASTODON_URL}statuses`, {
      mode: 'cors',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        status: tootText,
        sensitive: false,
        visibility: 'public',
        language: 'pt'
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Erro ao criar post: ${response.status} ${response.statusText}\n${errorBody}`);
    }

    const toot = await response.json();
    console.log('Post criado com sucesso! ID:', toot.id);
  } catch (error) {
    console.error('Erro ao criar o post:', error);
    throw error;
  }
}

main();