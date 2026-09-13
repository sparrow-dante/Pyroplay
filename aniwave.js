async function searchResults(keyword) {
    try {
        const encodedKeyword = encodeURIComponent(keyword);
        const responseText = await soraFetch(`https://aniwaves.ru/filter?keyword=${encodedKeyword}`);
        if (!responseText) throw new Error("No response from search endpoint");

        const html = await responseText.text();

        const regex = /<div\s+class="item\s*">[\s\S]*?<a\s+href="([^"]+)">[\s\S]*?<img\s+src="([^"]+)"[^>]*>[\s\S]*?<a\s+class="name\s+d-title"[^>]*>([^<]+)<\/a>/g;

        const results = [];
        let match;

        while ((match = regex.exec(html)) !== null) {
            const title = match[3].trim();

            if (title === "Omiai Aite Wa Oshiego Tsuyokina Mondaiji") {
                continue;
            }

            const href = match[1].trim();
            const image = match[2].trim();

            results.push({
                title,
                image,
                href: href.startsWith("http") ? href : `https://aniwaves.ru${href}`
            });
        }

        return JSON.stringify(results);
    } catch (error) {
        console.log("Fetch error in searchResults:", String(error));
        return JSON.stringify([{ title: "Error", image: "", href: "" }]);
    }
}

async function extractDetails(url) {
    try {
        const responseText = await soraFetch(url);
        if (!responseText) throw new Error("No response");

        const html = await responseText.text();

        const descriptionMatch = html.match(
            /<div class="synopsis mb-3">[\s\S]*?<div[^>]*class="[^"]*content[^"]*"[^>]*>(.*?)<\/div>/
        );

        let description = descriptionMatch
            ? descriptionMatch[1].trim()
            : "No description available";

        description = description.replace(/^Aired,\s+[^,]+,\s*/, "");

        const aliasesMatch = html.match(
            /<div class="names font-italic mb-2">(.*?)<\/div>/
        );

        const aliases = aliasesMatch
            ? aliasesMatch[1].trim()
            : "No aliases available";

        const airdateMatch = html.match(
            /Date aired:\s*<span><span[^>]*>(.*?)<\/span>/
        );

        const airdate = airdateMatch
            ? `Aired: ${airdateMatch[1].trim()}`
            : "Aired: Unknown";

        return JSON.stringify([{
            description,
            aliases,
            airdate
        }]);
    } catch (error) {
        console.log("Details error:", String(error));

        return JSON.stringify([{
            description: "Error loading description",
            aliases: "Duration: Unknown",
            airdate: "Aired/Released: Unknown"
        }]);
    }
}

async function extractEpisodes(url) {
    try {
        const slugMatch = url.match(/https:\/\/aniwaves\.ru\/watch\/([^\/]+)/);
        if (!slugMatch) throw new Error("Invalid URL");

        const animeSlug = slugMatch[1];

        const firstWordMatch = animeSlug.match(/^([^-]+)/);
        const firstSlugWord = firstWordMatch
            ? firstWordMatch[1]
            : animeSlug;

        const responseText = await soraFetch(url);
        if (!responseText) throw new Error("No response");

        const html = await responseText.text();

        const episodesMatch = html.match(/Episodes:\s*<span>(\d+)/);
        const episodesCount = episodesMatch
            ? parseInt(episodesMatch[1], 10)
            : 0;

        const transformedResults = [];

        if (episodesCount > 0) {
            for (let i = 1; i <= episodesCount; i++) {
                transformedResults.push({
                    href: `${url}/episode/${i}`,
                    number: i
                });
            }
        } else {
            const apiUrl =
                `https://aniwaves.ru/filter?keyword=${encodeURIComponent(firstSlugWord)}`;

            const searchResponse = await soraFetch(apiUrl);
            if (!searchResponse) throw new Error("No fallback search response");

            const searchHtml = await searchResponse.text();

            const regex = new RegExp(
                `<a\\s+[^>]*href="\\/watch\\/${animeSlug}"[^>]*>[\\s\\S]*?<span>Ep:\\s*(\\d+)<\\/span>`,
                "i"
            );

            const epMatch = searchHtml.match(regex);
            const fallbackCount = epMatch
                ? parseInt(epMatch[1], 10)
                : 0;

            for (let i = 1; i <= fallbackCount; i++) {
                transformedResults.push({
                    href: `${url}/episode/${i}`,
                    number: i
                });
            }
        }

        return JSON.stringify(transformedResults);
    } catch (error) {
        console.log("Fetch error in extractEpisodes:", String(error));
        return JSON.stringify([]);
    }
}

async function extractStreamUrl(url) {
    try {
        console.log("Input URL: " + url);

        const match = url.match(
            /https:\/\/aniwaves\.ru\/watch\/([^\/]+)\/episode\/(\d+)/
        );

        if (!match) {
            throw new Error(
                "Invalid URL format – expected /watch/SLUG/episode/NUM"
            );
        }

        const animeSlug = match[1];
        const episodeNumber = match[2];

        const idMatch = animeSlug.match(/(\d+)$/);
        if (!idMatch) {
            throw new Error("Could not extract show ID from slug");
        }

        const showId = idMatch[1];
        const headers = { Referer: url };

        const listUrl =
            "https://aniwaves.ru/ajax/server/list?servers=" +
            encodeURIComponent(showId) +
            "&eps=" +
            encodeURIComponent(episodeNumber);

        const listResp = await soraFetch(listUrl, { headers });
        if (!listResp) throw new Error("No response for server list");

        const rawText = await listResp.text();
        const listJson = JSON.parse(rawText);
        const html = listJson?.result || "";

        const subIdMatch = html.match(/data-link-id="([^"]+)"/);

        const dubIdMatch = html.match(
            /<div class="type" data-type="dub">[\s\S]*?data-link-id="([^"]+)"/
        );

        async function resolveM3u8(linkId, type) {
            try {
                const srcUrl =
                    "https://aniwaves.ru/ajax/sources?id=" +
                    encodeURIComponent(linkId) +
                    "&asi=0&autoPlay=0";

                const srcResp = await soraFetch(srcUrl, { headers });
                if (!srcResp) return null;

                const srcText = await srcResp.text();
                const srcData = JSON.parse(srcText);
                const embedUrl = srcData?.result?.url;

                if (!embedUrl) return null;

                const embedResp = await soraFetch(embedUrl, { headers });
                if (!embedResp) return null;

                const embedHtml = await embedResp.text();
                const dataIdMatch = embedHtml.match(/data-id="([^"]+)"/);

                if (!dataIdMatch) return null;

                const sourceId = dataIdMatch[1];

                const getSrcUrl =
                    "https://play.echovideo.ru/embed-1/getSources?id=" +
                    encodeURIComponent(sourceId);

                const getSrcResp = await soraFetch(getSrcUrl, { headers });
                if (!getSrcResp) return null;

                const getSrcText = await getSrcResp.text();
                const srcData2 = JSON.parse(getSrcText);
                const sources = srcData2?.sources;

                if (!sources) return null;

                return sources;
            } catch (e) {
                console.log(
                    "Error resolving " + type + ": " + String(e)
                );
                return null;
            }
        }

        const streams = [];

        if (subIdMatch) {
            const subSource = await resolveM3u8(
                subIdMatch[1],
                "SUB"
            );

            if (subSource) {
                streams.push({
                    title: "SUB",
                    streamUrl: subSource,
                    headers
                });
            }
        }

        if (dubIdMatch) {
            const dubSource = await resolveM3u8(
                dubIdMatch[1],
                "DUB"
            );

            if (dubSource) {
                streams.push({
                    title: "DUB",
                    streamUrl: dubSource,
                    headers
                });
            }
        }

        return JSON.stringify({
            streams,
            subtitles: ""
        });
    } catch (error) {
        console.log(
            "Fetch error in extractStreamUrl: " + String(error)
        );

        return JSON.stringify({
            streams: [],
            subtitles: ""
        });
    }
}

async function soraFetch(
    url,
    options = { headers: {}, method: "GET", body: null }
) {
    try {
        return await fetchv2(
            url,
            options.headers ?? {},
            options.method ?? "GET",
            options.body ?? null
        );
    } catch (e) {
        try {
            return await fetch(url, options);
        } catch (error) {
            return null;
        }
    }
}
