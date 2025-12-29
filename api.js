import { MASTODON_URL, CLIENT_KEY, CLIENT_SECRET, ACCESS_TOKEN } from './config.js';
import Mastodon from 'mastodon-api';
import { getPresentDayTimestamp } from './utils.js';

const M = new Mastodon({
  client_key: CLIENT_KEY,
  client_secret: CLIENT_SECRET,
  access_token: ACCESS_TOKEN,
  timeout_ms: 60 * 1000,
  api_url: MASTODON_URL,
});

export async function fetchTootsFromAPI(hashtag, params) {
  try {
    const response = await M.get(`timelines/tag/${hashtag}`, params);
    return response;
  } catch (error) {
    console.error(`Error fetching toots from API: ${error}`);
    throw error;
  }
}

export async function getHashtagUse(hashtag) {
  try {
    const response = await M.get(`tags/${hashtag}`);
    const accounts = response.data.accounts;
    const history = response.data.history;
    return history;
  } catch (error) {
    console.error(`Error fetching hashtag use: ${error}`);
    throw error;
  }
}

// Function that returns the result of getHashtagUse timestamp matching the present day timestamp
export async function presentDayHashtagUse(hashtag) {
  const history = await getHashtagUse(hashtag);
  const presentDay = await getPresentDayTimestamp(history);
  return presentDay ? history.filter((item) => item.day === presentDay) : null;
}

export async function getTrendingTags(limit = 10, offset = 0) {
  try {
    const response = await M.get('/trends/tags', { limit, offset });
    const trendingTags = response.data;
    return trendingTags;
  } catch (error) {
    console.error(`Error fetching trending tags: ${error}`);
    throw error;
  }
}

// Function to get the structured toot data
export async function getTootEmbed(tootId) {
  try {
    const response = await M.get(`statuses/${tootId}`);
    const toot = response.data;
    
    // Extract the essential toot data
    return {
      id: toot.id,
      content: toot.content,
      created_at: toot.created_at,
      account: {
        display_name: toot.account.display_name,
        username: toot.account.username,
        avatar: toot.account.avatar,
        url: toot.account.url
      },
      media_attachments: toot.media_attachments,
      favourites_count: toot.favourites_count,
      reblogs_count: toot.reblogs_count,
      replies_count: toot.replies_count,
      url: toot.url
    };
  } catch (error) {
    console.error(`Error fetching toot data: ${error}`);
    throw error;
  }
}