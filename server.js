const http = require("http");
const fs = require("fs");
const path = require("path");

const rootDir = __dirname;
const port = Number(process.env.PORT || 3000);
const env = loadEnvFile(path.join(rootDir, ".env"));
const groqApiKey = process.env.GROQ_API_KEY || env.GROQ_API_KEY || "";
const groqModel = process.env.GROQ_MODEL || env.GROQ_MODEL || "openai/gpt-oss-20b";

const mimeTypes = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".json": "application/json; charset=utf-8"
};

const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (request.method === "POST" && url.pathname === "/api/horoscope") {
        await handleHoroscopeApi(request, response);
        return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
        sendJson(response, 405, { error: "Method not allowed." });
        return;
    }

    serveStaticFile(url.pathname, response);
});

server.listen(port, () => {
    console.log(`Petuang Kejawen running at http://localhost:${port}`);
});

function loadEnvFile(filePath) {
    if (!fs.existsSync(filePath)) {
        return {};
    }

    return fs.readFileSync(filePath, "utf8")
        .split(/\r?\n/)
        .reduce((accumulator, line) => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) {
                return accumulator;
            }

            const separatorIndex = trimmed.indexOf("=");
            if (separatorIndex === -1) {
                return accumulator;
            }

            const key = trimmed.slice(0, separatorIndex).trim();
            const value = trimmed.slice(separatorIndex + 1).trim();
            accumulator[key] = value;
            return accumulator;
        }, {});
}

function serveStaticFile(requestPath, response) {
    const cleanPath = requestPath === "/" ? "/index.html" : requestPath;
    const resolvedPath = path.resolve(rootDir, `.${cleanPath}`);

    if (!resolvedPath.startsWith(rootDir)) {
        sendText(response, 403, "Forbidden");
        return;
    }

    fs.readFile(resolvedPath, (error, content) => {
        if (error) {
            sendText(response, 404, "Not found");
            return;
        }

        const extension = path.extname(resolvedPath).toLowerCase();
        response.writeHead(200, { "Content-Type": mimeTypes[extension] || "application/octet-stream" });
        response.end(content);
    });
}

async function handleHoroscopeApi(request, response) {
    if (!groqApiKey) {
        sendJson(response, 503, {
            error: "GROQ_API_KEY is not configured on the server."
        });
        return;
    }

    try {
        const body = await readJsonBody(request);
        const formattedDate = body.formattedDate || "";
        const entries = Array.isArray(body.entries) ? body.entries : [];
        const mode = body.mode === "all" ? "all" : "personal";

        if (!entries.length) {
            sendJson(response, 400, { error: "entries is required." });
            return;
        }

        const prompt = buildGroqPrompt(entries, formattedDate, mode);
        const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${groqApiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: groqModel,
                temperature: 1,
                response_format: { type: "json_object" },
                messages: [
                    {
                        role: "system",
                        content: "You are an expert horoscope copywriter. Return valid JSON only. Write in Indonesian with a modern, natural, vivid tone. Make each zodiac sound distinct, personal, and AI-generated. Avoid repetitive sentence structure across entries."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ]
            })
        });

        if (!groqResponse.ok) {
            const errorText = await groqResponse.text();
            sendJson(response, groqResponse.status, { error: errorText });
            return;
        }

        const payload = await groqResponse.json();
        const content = payload?.choices?.[0]?.message?.content;
        if (!content) {
            sendJson(response, 502, { error: "Empty Groq response." });
            return;
        }

        const parsed = JSON.parse(content);
        sendJson(response, 200, parsed);
    } catch (error) {
        sendJson(response, 500, { error: error.message || "Unexpected server error." });
    }
}

function buildGroqPrompt(entries, formattedDate, mode) {
    return JSON.stringify({
        task: "Generate distinct horoscope content for each entry.",
        rules: [
            "Return a JSON object with key entries.",
            "entries must be an array with the same zodiac names in the same order.",
            "Each array item must contain: name, vibe, powerMove, love, finance, energy, social, warning.",
            "Each field must be 1-3 sentences, natural Indonesian, expressive, and not repetitive across zodiac entries.",
            "Do not use markdown.",
            "Blend mystical intuition with modern conversational tone.",
            "Use the provided base data, but rewrite it into more original, specific copy."
        ],
        mode,
        formattedDate,
        entries
    }, null, 2);
}

function readJsonBody(request) {
    return new Promise((resolve, reject) => {
        let data = "";
        request.on("data", (chunk) => {
            data += chunk;
        });
        request.on("end", () => {
            try {
                resolve(data ? JSON.parse(data) : {});
            } catch (error) {
                reject(new Error("Invalid JSON body."));
            }
        });
        request.on("error", reject);
    });
}

function sendJson(response, statusCode, payload) {
    response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, text) {
    response.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(text);
}
