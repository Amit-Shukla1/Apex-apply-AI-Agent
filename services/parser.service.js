import pdf from "pdf-parse";
import axios from "axios";

export const parseResume = async (buffer) => {
  try {
    const data = await pdf(buffer);
    if (!data.text || data.text.trim() === "") {
      throw new Error(
        "PDF parsed, but no text found. Is it an image-based/scanned PDF?",
      );
    }
    return data.text;
  } catch (err) {
    throw new Error(`PDF Extractor Failed: ${err.message}`);
  }
};

export const getSearchProfile = async (resumeText) => {
  const prompt = `Analyze this resume. Based on the skills listed, identify 4 distinct job titles the candidate is qualified for. Output strictly as JSON: { "titles": [], "skills": [] }`;

  try {
    // The ultimate stable fix: Direct REST call bypassing all SDKs
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const payload = {
      contents: [{ parts: [{ text: prompt + "\n\nResume: " + resumeText }] }],
    };

    const res = await axios.post(url, payload, {
      headers: { "Content-Type": "application/json" },
    });

    if (!res.data || !res.data.candidates || res.data.candidates.length === 0) {
      throw new Error("Google API returned an empty response.");
    }

    let rawOutput = res.data.candidates[0].content.parts[0].text;

    // Strip markdown backticks to prevent JSON parsing crashes
    rawOutput = rawOutput
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();
    return JSON.parse(rawOutput);
  } catch (err) {
    let errorMessage = err.message;
    if (err.response && err.response.data && err.response.data.error) {
      errorMessage = err.response.data.error.message;
    } else if (err.name === "SyntaxError") {
      errorMessage = "AI returned invalid JSON format.";
    }
    throw new Error(`Google REST Rejection: ${errorMessage}`);
  }
};
