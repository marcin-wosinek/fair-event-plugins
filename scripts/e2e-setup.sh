#!/bin/bash
set -e

npm run build
npm run composer:install:prod
wp-env start

echo "Waiting for WordPress to finish installing..."
for i in $(seq 1 20); do
    if wp-env run tests-cli wp core is-installed > /dev/null 2>&1; then
        break
    fi
    if [ "$i" -eq 20 ]; then
        echo "WordPress did not finish installing in time"
        exit 1
    fi
    sleep 3
done

wp-env run tests-cli wp rewrite structure '/%postname%/' --hard
