import { Injectable } from '@angular/core';
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";

export interface TriageResult {
  status: string;
  priority_color: 'Red' | 'Yellow' | 'Green';
  danger_signs_present: boolean;
  suspected_conditions: string[];
  key_findings: string[];
  immediate_actions: string[];
  parent_advice: string[];
  referral_needed: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class GeminiService {
  private ai: GoogleGenAI;

  constructor() {
    // GEMINI_API_KEY is defined in src/globals.d.ts and injected via environment
    this.ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  }

  async analyzeTriage(symptoms: string, imageBase64?: string | null): Promise<TriageResult> {
    const model = "gemini-3-flash-preview";
    
    const systemInstruction = `You are HealthGuard AI, a medical triage assistant for community health workers in East and Central Africa.
Expertise: Child health (0–5 years), Tropical diseases.
Guidelines: Strictly follow WHO IMCI (Integrated Management of Childhood Illness).

RESPONSE PROTOCOL:
1. Detect Danger Signs: Unable to drink/breastfeed, vomits everything, convulsions, lethargic/unconscious. If present -> CRITICAL.
2. Clinical Assessment: Malaria (Fever + endemic), Pneumonia (Cough + fast breathing/chest indrawing), Malnutrition (Wasting + MUAC < 11.5cm + edema).
3. Risk Classification: Red (Emergency), Yellow (Treatment/Monitoring), Green (Home care).
4. Real-time Alert Logic: If priority_color is "Red" OR danger_signs_present is true, referral_needed MUST be true.

OUTPUT CONSTRAINTS:
- Return ONLY a clean JSON object.
- Use snake_case for all keys.
- parent_advice MUST be an array of clear, actionable strings for the caregiver.
- suspected_conditions MUST be an array of strings.
- Ensure all values are properly formatted.`;

    const parts: ({ text: string } | { inlineData: { data: string; mimeType: string } })[] = [{ text: symptoms }];
    if (imageBase64) {
      const base64Data = imageBase64.split(',')[1];
      const mimeType = imageBase64.split(';')[0].split(':')[1];
      parts.push({
        inlineData: {
          data: base64Data,
          mimeType: mimeType
        }
      });
    }

    const response: GenerateContentResponse = await this.ai.models.generateContent({
      model: model,
      contents: { parts },
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            status: { type: Type.STRING },
            priority_color: { type: Type.STRING, enum: ["Red", "Yellow", "Green"] },
            danger_signs_present: { type: Type.BOOLEAN },
            suspected_conditions: { type: Type.ARRAY, items: { type: Type.STRING } },
            key_findings: { type: Type.ARRAY, items: { type: Type.STRING } },
            immediate_actions: { type: Type.ARRAY, items: { type: Type.STRING } },
            parent_advice: { type: Type.ARRAY, items: { type: Type.STRING } },
            referral_needed: { type: Type.BOOLEAN }
          },
          required: ["status", "priority_color", "danger_signs_present", "suspected_conditions", "key_findings", "immediate_actions", "parent_advice", "referral_needed"]
        }
      }
    });

    try {
      return JSON.parse(response.text || '{}') as TriageResult;
    } catch (e) {
      console.error("Failed to parse AI response", e);
      throw new Error("Failed to analyze triage data. Please try again.");
    }
  }
}
