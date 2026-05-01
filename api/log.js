import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  const LOG_KEY = 'fx_signal_log_v2';

  if (req.method === 'GET') {
    try {
      const logs = await kv.get(LOG_KEY) || [];
      return res.status(200).json(logs);
    } catch (error) {
      return res.status(500).json({ error: 'Failed to fetch logs' });
    }
  }

  if (req.method === 'DELETE') {
    try {
      await kv.set(LOG_KEY, []);
      return res.status(200).json({ message: 'Logs cleared' });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to clear logs' });
    }
  }

  if (req.method === 'POST') {
    // For manual sync or cron updates
    try {
      const { logs } = req.body;
      await kv.set(LOG_KEY, logs);
      return res.status(200).json({ message: 'Logs updated' });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to update logs' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
