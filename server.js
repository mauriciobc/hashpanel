import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { HASHTAGS } from './constants.js';
import { PREFERRED_TIMEZONE } from './config.js';
import { getHashtagUse, presentDayHashtagUse, fetchTootsFromAPI, getTrendingTags } from './api.js';
import { sortTootsByRelevance, removeIgnoredToots, filterTootsByDate, generateTootLink } from './utils.js';
import moment from 'moment-timezone';

// Configure ES module paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Express
dotenv.config();
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Get current day's hashtag
function getCurrentHashtag() {
  return HASHTAGS[new Date().getDay()];
}

// Hashtag statistics endpoint
app.get('/api/hashtag-stats', async (req, res) => {
  try {
    const hashtag = getCurrentHashtag();
    const [history, todayData] = await Promise.all([
      getHashtagUse(hashtag),
      presentDayHashtagUse(hashtag)
    ]);

    const weeklyTotal = history.reduce((sum, day) => sum + parseInt(day.uses), 0);
    const todayUses = todayData?.[0]?.uses || 0;
    const uniqueUsers = todayData?.[0]?.accounts?.length || 0;

    res.json({ hashtag, todayUses, uniqueUsers, weeklyTotal });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Top toots endpoint
app.get('/api/top-toots', async (req, res) => {
  try {
    const hashtag = getCurrentHashtag();
    const response = await fetchTootsFromAPI(hashtag, { limit: 100 });
    let toots = response.data;

    // Process toots
    toots = removeIgnoredToots(toots);
    toots = await sortTootsByRelevance(toots);
    toots = filterTootsByDate(
      toots,
      moment().tz(PREFERRED_TIMEZONE).format('YYYY-MM-DD')
    );

    // Format top toots
    const topToots = await Promise.all(
      toots.slice(0, 5).map(async (toot) => ({
        author: toot.account.username,
        followers: toot.account.followers_count,
        favorites: toot.favourites_count,
        boosts: toot.reblogs_count,
        relevance: toot.relevanceScore,
        link: await generateTootLink(toot.id)
      }))
    );

    res.json(topToots);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Trending tags endpoint
app.get('/api/trending-tags', async (req, res) => {
  try {
    const { limit = 10, offset = 0 } = req.query;
    const trendingTags = await getTrendingTags(parseInt(limit), parseInt(offset));
    res.json(trendingTags);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Consolidated dashboard data endpoint for better performance
app.get('/api/dashboard-data', async (req, res) => {
  try {
    const hashtag = getCurrentHashtag();
    
    // Fetch all data in parallel
    const [history, todayData, tootsResponse, trendingTags] = await Promise.all([
      getHashtagUse(hashtag),
      presentDayHashtagUse(hashtag),
      fetchTootsFromAPI(hashtag, { limit: 100 }),
      getTrendingTags(10, 0)
    ]);

    // Process hashtag statistics
    const weeklyTotal = history.reduce((sum, day) => sum + parseInt(day.uses), 0);
    const todayUses = todayData?.[0]?.uses || 0;
    const uniqueUsers = todayData?.[0]?.accounts?.length || 0;

    // Process toots
    let toots = tootsResponse.data;
    toots = removeIgnoredToots(toots);
    toots = await sortTootsByRelevance(toots);
    toots = filterTootsByDate(
      toots,
      moment().tz(PREFERRED_TIMEZONE).format('YYYY-MM-DD')
    );

    // Format top toots
    const topToots = await Promise.all(
      toots.slice(0, 5).map(async (toot) => ({
        author: toot.account.username,
        followers: toot.account.followers_count,
        favorites: toot.favourites_count,
        boosts: toot.reblogs_count,
        relevance: toot.relevanceScore,
        link: await generateTootLink(toot.id)
      }))
    );

    res.json({
      stats: { hashtag, todayUses, uniqueUsers, weeklyTotal },
      topToots,
      trendingTags
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));