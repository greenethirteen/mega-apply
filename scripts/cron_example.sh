#!/usr/bin/env bash
# Run every 4 hours with logs
cd /path/to/rapidapply-saudi-addon
/usr/bin/env -i bash -lc 'source ~/.bashrc; export NODE_ENV=production; npm run scrape >> logs.txt 2>&1'
