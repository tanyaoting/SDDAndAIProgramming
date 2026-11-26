#!/usr/bin/env node
import { cliMain } from './cli/run.js';

void cliMain(process.argv.slice(2));