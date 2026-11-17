import { MCP_LIMITS, type McpAction } from "@chartermission/contracts";

/**
 * Where Claude connects to Charter Mission (apps/mcp). Members paste it into Claude as a custom
 * connector. Set NEXT_PUBLIC_MCP_URL at build time for another environment.
 */
export const MCP_URL = process.env.NEXT_PUBLIC_MCP_URL || "https://mcp.chartermission.com/mcp";

/** What Claude did, as one sentence in the activity list (the target kind refines reactions and follows). */
export function mcpActionLabel(action: McpAction, targetType: string | null): string {
  switch (action) {
    case "post.create":
      return "Published a post";
    case "post.edit":
      return "Edited a post";
    case "post.delete":
      return "Deleted a post";
    case "draft.save":
      return "Saved a draft";
    case "post.schedule":
      return "Scheduled a post";
    case "draft.publish":
      return "Published a draft";
    case "comment.create":
      return "Wrote a comment";
    case "comment.edit":
      return "Edited a comment";
    case "comment.delete":
      return "Deleted a comment";
    case "reaction.set":
      return targetType === "comment" ? "Reacted to a comment" : "Reacted to a post";
    case "reaction.remove":
      return targetType === "comment" ? "Removed a reaction from a comment" : "Removed a reaction from a post";
    case "connection.request":
      return "Sent a connection request";
    case "connection.accept":
      return "Accepted a connection request";
    case "follow":
      return FOLLOW[targetType ?? ""] ?? "Followed someone";
    case "unfollow":
      return UNFOLLOW[targetType ?? ""] ?? "Unfollowed someone";
  }
}

const FOLLOW: Record<string, string> = {
  member: "Followed a member",
  hashtag: "Followed a topic",
  chapter: "Followed a chapter",
  page: "Followed a page",
};

const UNFOLLOW: Record<string, string> = {
  member: "Unfollowed a member",
  hashtag: "Unfollowed a topic",
  chapter: "Unfollowed a chapter",
  page: "Unfollowed a page",
};

/**
 * Hourly limits shown on the consent page, read from the shared contract so they never drift.
 * Posts covers publishing, scheduling and publishing drafts: they share post.create's allowance.
 */
export const MCP_HOURLY = {
  posts: MCP_LIMITS["post.create"]?.perHour ?? 0,
  comments: MCP_LIMITS["comment.create"]?.perHour ?? 0,
  requests: MCP_LIMITS["connection.request"]?.perHour ?? 0,
};
