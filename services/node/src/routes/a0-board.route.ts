import { createA0BoardReader, type BoardData } from '../a0-board.ts';
import type { Route } from './registry.ts';

export function a0BoardRoute(read: () => Promise<BoardData> = createA0BoardReader()): Route {
  // Mutations belong to the local ab-note writer. Keep the board GET-only: talking to
  // Agent Zero changes notes; reading the board never acquires write authority.
  return { method:'GET',path:/^\/api\/a0\/board$/,async handle(_req,res) {
    const board = await read();
    res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
    res.end(JSON.stringify(board));
  }};
}
export const route = a0BoardRoute();
