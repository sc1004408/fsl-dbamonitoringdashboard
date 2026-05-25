import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';

export interface User {
  id: number;
  username: string;
  role: 'admin' | 'reader';
}

export interface RequestWithUser extends Request {
  user?: User;
}

const parseAuthUser = (authHeader?: string): User | null => {
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  try {
    const token = authHeader.slice('Bearer '.length);
    const payload = jwt.verify(token, env.JWT_SECRET) as {
      sub?: number | string;
      username?: string;
      role?: 'admin' | 'reader';
    };

    if (!payload.role || !payload.username) {
      return null;
    }

    return {
      id: Number(payload.sub ?? 0),
      username: payload.username,
      role: payload.role
    };
  } catch {
    return null;
  }
};

export const errorHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) => {
  const message = err instanceof Error ? err.message : 'Unexpected server error';
  res.status(500).json({ error: message });
};

export const checkRole = (role: 'admin' | 'reader') => {
  return (req: RequestWithUser, res: Response, next: NextFunction) => {
    const user = parseAuthUser(req.headers.authorization);
    if (!user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    req.user = user;

    const userRole = req.user?.role; // Assuming req.user is populated by authentication middleware

    if (!userRole) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    if (userRole !== role) {
      return res.status(403).json({ message: 'Forbidden: Insufficient permissions' });
    }

    next();
  };
};

export const requireAuth = (req: RequestWithUser, res: Response, next: NextFunction) => {
  const user = parseAuthUser(req.headers.authorization);
  if (!user) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  req.user = user;
  next();
};
