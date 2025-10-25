// lib/prisma.js
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis;

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: ["warn", "error"], // pode pôr "query" se quiser ver SQL
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
