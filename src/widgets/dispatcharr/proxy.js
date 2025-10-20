import getServiceWidget from "utils/config/service-helpers";
import createLogger from "utils/logger";
import { formatApiCall } from "utils/proxy/api-helpers";
import { httpProxy } from "utils/proxy/http";
import widgets from "widgets/widgets";

const logger = createLogger("dispatcharrProxyHandler");

export default async function dispatcharrProxyHandler(req, res) {
  const { group, service, index } = req.query;

  if (!group || !service) {
    return res.status(400).json({ error: "Invalid proxy service type" });
  }

  const widget = await getServiceWidget(group, service, index);
  const api = widgets?.[widget.type]?.api;
  if (!api) {
    return res.status(403).json({ error: "Service does not support API calls" });
  }

  let sessionCookie = null;

  // Login to get session if credentials are provided
  if (widget.username && widget.password) {
    const loginUrl = formatApiCall(api, { endpoint: "api/accounts/auth/login/", ...widget });
    const loginPayload = JSON.stringify({
      username: widget.username,
      password: widget.password,
    });

    const [loginStatus, , loginData, loginHeaders] = await httpProxy(loginUrl, {
      method: "POST",
      body: loginPayload,
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (loginStatus !== 200) {
      logger.debug("Error logging into dispatcharr", loginStatus, loginUrl);
      return res.status(loginStatus).json({ error: { message: `HTTP Error ${loginStatus} logging into dispatcharr`, url: loginUrl, data: loginData } });
    }

    // Extract session cookie from Set-Cookie header
    const setCookieHeader = loginHeaders?.["set-cookie"];
    if (setCookieHeader) {
      sessionCookie = setCookieHeader
        .map((cookie) => cookie.split(";")[0])
        .join("; ");
    }
  }

  // Fetch data from multiple endpoints to build stats
  const headers = {
    "Content-Type": "application/json",
  };
  
  if (sessionCookie) {
    headers.Cookie = sessionCookie;
  }

  // Query channels endpoint
  const channelsUrl = formatApiCall(api, { endpoint: "api/channels/channels/", ...widget });
  const [channelsStatus, , channelsData] = await httpProxy(channelsUrl, {
    method: "GET",
    headers,
  });

  // Query streams endpoint
  const streamsUrl = formatApiCall(api, { endpoint: "api/channels/streams/", ...widget });
  const [streamsStatus, , streamsData] = await httpProxy(streamsUrl, {
    method: "GET",
    headers,
  });

  if (channelsStatus !== 200 || streamsStatus !== 200) {
    logger.debug("Error calling dispatcharr endpoints - channels: %d, streams: %d", channelsStatus, streamsStatus);
    return res.status(channelsStatus !== 200 ? channelsStatus : streamsStatus).json({ 
      error: { message: `HTTP Error fetching data`, channelsStatus, streamsStatus } 
    });
  }

  const channelsJson = JSON.parse(channelsData.toString());
  const streamsJson = JSON.parse(streamsData.toString());

  // Build response with counts
  const response = {
    channels: channelsJson.count || 0,
    streams: streamsJson.count || 0,
    active_streams: streamsJson.results?.filter(s => s.current_viewers > 0).length || 0,
  };

  return res.status(200).json(response);
}
