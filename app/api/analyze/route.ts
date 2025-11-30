import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Get your API key from https://aistudio.google.com/app/apikey
const API_KEY = process.env.GEMINI_API_KEY || 'YOUR_API_KEY';

const genAI = new GoogleGenerativeAI(API_KEY);

export async function POST(request: Request) {
  const { answers, questions, outcomes } = await request.json();

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

    const prompt = `
      As an expert educator and AI assistant, your task is to analyze a student's exam answers.
      Provide a detailed analysis of the student's performance, focusing on the following:

      1.  **Overall Summary:** A brief overview of the student's performance.
      2.  **Strengths:** Identify areas where the student demonstrated strong understanding.
      3.  **Weaknesses:** Pinpoint specific topics or concepts where the student struggled.
      4.  **Actionable Feedback:** Suggest concrete steps the student can take to improve.
      5.  **Learning Outcomes Analysis:** Assess how well the student met the defined learning outcomes.

      **Exam Details:**

      *   **Learning Outcomes:** ${JSON.stringify(outcomes)}
      *   **Questions:** ${JSON.stringify(questions)}
      *   **Student's Answers:** ${JSON.stringify(answers)}
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const analysis = await response.text();

    return NextResponse.json({ success: true, analysis });
  } catch (error) {
    console.error('Error analyzing exam:', error);
    return NextResponse.json({ success: false, error: 'Failed to analyze exam' }, { status: 500 });
  }
}
