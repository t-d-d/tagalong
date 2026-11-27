// Setup for every tier: removes the folders tempDir made once the test file
// ends. Setup files register their hooks first, so this runs after the
// file's own afterAll has stopped what writes into them.
import { afterAll } from "vitest";
import { removeTempDirs } from "./temp.ts";

afterAll(removeTempDirs);
