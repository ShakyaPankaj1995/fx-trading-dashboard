import { Redis } from '@upstash/redis';

const LOG_KEY = 'fx_signal_log_v2';

function getRedis() {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export default async function handler(req, res) {
  const redis = getRedis();

  if (req.method === 'GET') {
    try {
      const logs = redis ? (await redis.get(LOG_KEY) || []) : [];
      return res.status(200).json(logs);
    } catch (error) {
      return res.status(200).json([]); // graceful fallback
    }
  }

  if (req.method === 'DELETE') {
    try {
      if (redis) await redis.set(LOG_KEY, []);
      return res.status(200).json({ message: 'Logs cleared' });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to clear logs' });
    }
  }

  if (req.method === 'POST') {
    try {
      const { logs } = req.body;
      if (redis) await redis.set(LOG_KEY, logs);
      return res.status(200).json({ message: 'Logs updated' });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to update logs' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
