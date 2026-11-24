import Anthropic from '@anthropic-ai/sdk';
import {
  FLOOR_PHOTO_JSON_SCHEMA,
  type FloorPhotoInput,
  type FloorPhotoReading,
  floorPhotoReadingSchema,
} from '@pos/core';
import { ApiError } from '../../errors';

/**
 * Reads where the tables are in a photo or a sketch of a dining room (DEC-056). The AI only
 * proposes: the result goes to the editor and nothing is saved until a person confirms (PA-07).
 * The photo is sent once and not kept.
 */
export type FloorPhotoReader = (
  photo: FloorPhotoInput,
  context: { areaName: string; knownLabels: readonly string[] },
) => Promise<FloorPhotoReading>;

const MODEL = 'claude-opus-5-5';

const SYSTEM = `You read photos and hand-drawn sketches of restaurant dining rooms and report where the tables are, for a point-of-sale floor plan.

For every table you can see, give its bounding box in percent of the image (x and y of the top-left corner, width and height; 0 to 100), its shape ("round" for round tables, otherwise "rect"), the number or name written on or next to it (null if none is visible), and the number of chairs or places around it (null if you cannot tell).

Rules:
- One entry per table. Two tables pushed together that are clearly used as one count as one long table.
- Ignore chairs, bar counters, plants, walls and people; only tables.
- Boxes follow the view in the image as it is; do not rotate or reorder.
- If the picture is not a dining room or shows no tables, return an empty list and say why in notes.
- Use notes only for what the owner should check (a corner that is cut off, tables hidden behind others). Keep it to one or two short sentences, in the language of the area name.`;

/** The reader that calls Claude, or null when no API key is configured. */
export function claudeFloorReader(
  apiKey: string | undefined = process.env.ANTHROPIC_API_KEY,
): FloorPhotoReader | null {
  if (!apiKey) return null;
  const client = new Anthropic({ apiKey });
  return async (photo, context) => {
    let response;
    try {
      response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        // A safety classifier can decline even a harmless photo; the API then retries on the
        // model Anthropic recommends, inside the same call.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: {
          effort: 'high',
          format: { type: 'json_schema', schema: { ...FLOOR_PHOTO_JSON_SCHEMA } },
        },
        system: SYSTEM,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: photo.mediaType, data: photo.data },
              },
              {
                type: 'text',
                text:
                  `Area: ${context.areaName}.` +
                  (context.knownLabels.length > 0
                    ? ` Tables of this area today: ${context.knownLabels.join(', ')}.`
                    : '') +
                  ' Where are the tables?',
              },
            ],
          },
        ],
      });
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        throw new ApiError('RULE_VIOLATION', 'The AI could not read the photo now', {
          reason: 'ai_failed',
          status: error.status ?? null,
        });
      }
      throw error;
    }
    if (response.stop_reason === 'refusal') {
      throw new ApiError('RULE_VIOLATION', 'The AI declined to read this photo', {
        reason: 'ai_refused',
      });
    }
    const text = response.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('');
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    const reading = floorPhotoReadingSchema.safeParse(json);
    if (response.stop_reason === 'max_tokens' || !reading.success) {
      throw new ApiError('RULE_VIOLATION', 'The AI answer could not be used', {
        reason: 'ai_unreadable',
      });
    }
    return reading.data;
  };
}
