import { OpenAPIRegistry, type RouteConfig } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

export const workspaceSlugParam = z.string().meta({ description: "The workspace's slug.", example: "acme-inc" });

/**
 * Registers paths under /workspaces/{workspace}, adding the slug parameter, so modules document
 * their routes the way they mount them. A path of "/" is the workspace itself.
 */
export class WorkspaceRegistry extends OpenAPIRegistry {
  override registerPath(route: RouteConfig) {
    const params = route.request?.params;
    super.registerPath({
      ...route,
      path: `/workspaces/{workspace}${route.path === "/" ? "" : route.path}`,
      request: {
        ...route.request,
        params: z.object({ workspace: workspaceSlugParam, ...(params && "shape" in params ? params.shape : {}) }),
      },
    });
  }
}
