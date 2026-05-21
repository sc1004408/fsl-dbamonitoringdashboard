import OpenAI from 'openai';
import { env } from '../config/env';

type InsightInput = {
  health: unknown;
  performance: unknown;
  storage: unknown;
  alerts: unknown;
};

const localInsight = (snapshot: InsightInput): string => {
  const base = [
    'AI MODE: Local diagnostic summary',
    `Health: ${JSON.stringify(snapshot.health)}`,
    `Performance: ${JSON.stringify(snapshot.performance)}`,
    `Storage: ${JSON.stringify(snapshot.storage)}`,
    `Alerts: ${JSON.stringify(snapshot.alerts)}`,
    'Recommendations:',
    '1) Investigate top waits and tune expensive queries.',
    '2) Add index maintenance and statistics update windows.',
    '3) Set alert thresholds for blocking sessions and failed SQL jobs.'
  ];
  return base.join('\n');
};

export const aiService = {
  async generateInsights(snapshot: InsightInput): Promise<string> {
    if (env.AI_PROVIDER !== 'openai' || !env.OPENAI_API_KEY) {
      return localInsight(snapshot);
    }

    const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    const response = await client.responses.create({
      model: env.OPENAI_MODEL,
      input: [
        {
          role: 'system',
          content:
            'You are a senior SQL Server reliability engineer. Analyze metrics and return concise actions and risk levels.'
        },
        {
          role: 'user',
          content: `Analyze this DB snapshot: ${JSON.stringify(snapshot)}`
        }
      ]
    });

    return response.output_text || localInsight(snapshot);
  }
};
