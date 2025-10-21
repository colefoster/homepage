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

  // Log credential status for debugging
  if (widget.username && widget.password) {
    logger.info("Dispatcharr credentials found - username: '%s', password: %s", 
      widget.username, 
      widget.password ? `[${widget.password.length} characters]` : '[not set]'
    );
  } else if (widget.username && !widget.password) {
    logger.warn("Dispatcharr username provided but password is missing");
  } else if (!widget.username && widget.password) {
    logger.warn("Dispatcharr password provided but username is missing");
  } else {
    logger.info("No Dispatcharr credentials provided - attempting anonymous access");
  }

  let accessToken = null;

  // Login to get JWT access token if credentials are provided
  if (widget.username && widget.password) {
    const tokenUrl = formatApiCall(api, { endpoint: "api/accounts/token/", ...widget });
    const tokenPayload = JSON.stringify({
      username: widget.username,
      password: widget.password,
    });

    let tokenStatus;
    let tokenData;
    
    try {
      [tokenStatus, , tokenData] = await httpProxy(tokenUrl, {
        method: "POST",
        body: tokenPayload,
        headers: {
          "Content-Type": "application/json",
        },
      });
    } catch (err) {
      logger.error("Error connecting to Dispatcharr token endpoint: %s", err.message);
      return res.status(500).json({ 
        error: { 
          message: "Connection error during authentication", 
          url: tokenUrl,
          data: err.message,
          raw: err
        } 
      });
    }

    if (tokenStatus !== 200) {
      logger.error("Token request failed with status %d", tokenStatus);
      let errorData = tokenData;
      try {
        errorData = JSON.parse(tokenData.toString());
      } catch (e) {
        errorData = tokenData.toString();
      }
      return res.status(tokenStatus).json({ 
        error: { 
          message: `HTTP Error ${tokenStatus} authenticating with Dispatcharr`, 
          url: tokenUrl, 
          data: errorData 
        } 
      });
    }

    logger.info("Token request successful with status 200");
    
    // Extract JWT access token from response
    try {
      const tokenResponse = JSON.parse(tokenData.toString());
      accessToken = tokenResponse.access;
      
      if (accessToken) {
        logger.info("Successfully obtained JWT access token (length: %d characters)", accessToken.length);
      } else {
        logger.error("Token response did not contain 'access' field. Response: %s", JSON.stringify(tokenResponse));
        return res.status(500).json({ 
          error: { 
            message: "Invalid token response from Dispatcharr - missing 'access' field", 
            url: tokenUrl,
            data: tokenResponse
          } 
        });
      }
    } catch (e) {
      logger.error("Could not parse token response as JSON: %s", e.message);
      return res.status(500).json({ 
        error: { 
          message: "Invalid JSON response from token endpoint", 
          url: tokenUrl,
          data: tokenData.toString()
        } 
      });
    }
  }

  // Fetch data from multiple endpoints to build stats
  const headers = {
    "Content-Type": "application/json",
  };
  
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
    logger.info("Using JWT Bearer token for authenticated requests");
  } else if (widget.username && widget.password) {
    logger.warn("Authentication was attempted but no access token was obtained");
  } else {
    logger.debug("No authentication credentials provided, attempting anonymous access");
  }

  // Query channels endpoint
  const channelsUrl = formatApiCall(api, { endpoint: "api/channels/channels/", ...widget });
  logger.debug("Requesting channels with headers: %s", JSON.stringify(headers));
  
  let channelsStatus;
  let channelsData;
  
  try {
    [channelsStatus, , channelsData] = await httpProxy(channelsUrl, {
      method: "GET",
      headers,
    });
  } catch (err) {
    logger.error("Error connecting to Dispatcharr channels endpoint: %s", err.message);
    return res.status(500).json({ 
      error: { 
        message: "Connection error fetching channels", 
        url: channelsUrl,
        data: err.message,
        raw: err
      } 
    });
  }

  if (channelsStatus !== 200) {
    logger.debug("Error calling dispatcharr channels endpoint: %d", channelsStatus);
    let errorData = channelsData;
    try {
      errorData = JSON.parse(channelsData.toString());
    } catch (e) {
      errorData = channelsData.toString();
    }
    
    // Add helpful message for authentication errors
    let message = `HTTP Error ${channelsStatus} fetching channels`;
    if (channelsStatus === 401 || channelsStatus === 403 || (errorData?.detail && errorData.detail.includes("Authentication"))) {
      message = `Authentication failed - check username and password. ${message}`;
    }
    
    return res.status(channelsStatus).json({ 
      error: { 
        message, 
        url: channelsUrl, 
        data: errorData 
      } 
    });
  }

  // Query streams endpoint
  const streamsUrl = formatApiCall(api, { endpoint: "api/channels/streams/", ...widget });
  let streamsStatus;
  let streamsData;
  
  try {
    [streamsStatus, , streamsData] = await httpProxy(streamsUrl, {
      method: "GET",
      headers,
    });
  } catch (err) {
    logger.error("Error connecting to Dispatcharr streams endpoint: %s", err.message);
    return res.status(500).json({ 
      error: { 
        message: "Connection error fetching streams", 
        url: streamsUrl,
        data: err.message,
        raw: err
      } 
    });
  }

  if (streamsStatus !== 200) {
    logger.debug("Error calling dispatcharr streams endpoint: %d", streamsStatus);
    let errorData = streamsData;
    try {
      errorData = JSON.parse(streamsData.toString());
    } catch (e) {
      errorData = streamsData.toString();
    }
    
    // Add helpful message for authentication errors
    let message = `HTTP Error ${streamsStatus} fetching streams`;
    if (streamsStatus === 401 || streamsStatus === 403 || (errorData?.detail && errorData.detail.includes("Authentication"))) {
      message = `Authentication failed - check username and password. ${message}`;
    }
    
    return res.status(streamsStatus).json({ 
      error: { 
        message, 
        url: streamsUrl, 
        data: errorData 
      } 
    });
  }

  const channelsJson = JSON.parse(channelsData.toString());
  const streamsJson = JSON.parse(streamsData.toString());

  // Build response with counts
  const response = {
    channels: channelsJson.length || channelsJson.count || -1,
    streams: streamsJson.count || 0,
    active_streams: streamsJson.results?.filter(s => s.current_viewers > 0).length || 0,
  };

  return res.status(200).json(response);
}
