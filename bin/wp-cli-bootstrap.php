<?php
// Silence PHP 8.1+ deprecation notices from wp-cli's bundled php-cli-tools
// (cli/Colors.php:95 indexes an array with a null offset). Upstream issue,
// not something we can fix here; remove once wp-cli ships a fix.
error_reporting( E_ALL & ~E_DEPRECATED );
