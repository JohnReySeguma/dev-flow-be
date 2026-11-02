import type { Request, RequestHandler } from "express";
import type { PaginationQuery } from "../../lib/pagination.js";
import { authOf } from "../../middleware/require-auth.js";
import type { CreateTokenInput } from "./tokens.schemas.js";
import type { TokensService } from "./tokens.service.js";

// validate({ query: paginationQuery }) has already replaced req.query with the parsed value.
const validatedQuery = (req: Request) => req.query as unknown as PaginationQuery;

export function createTokensController(tokens: TokensService) {
  const list: RequestHandler = async (req, res) => {
    res.set("Cache-Control", "no-store").json(await tokens.list(authOf(req).userId, validatedQuery(req)));
  };

  const create: RequestHandler = async (req, res) => {
    res
      .status(201)
      .set("Cache-Control", "no-store")
      .json(await tokens.create(authOf(req).userId, req.body as CreateTokenInput));
  };

  const revoke: RequestHandler = async (req, res) => {
    await tokens.revoke(authOf(req).userId, String(req.params.id));
    res.status(204).end();
  };

  return { list, create, revoke };
}
