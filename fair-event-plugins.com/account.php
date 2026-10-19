<?php
/**
 * POST: create a Stripe connected account. Responds with `{ account }` or `{ error }`.
 *
 * @package MarcinWosinek\FairEventPluginsCom
 */

use MarcinWosinek\FairEventPluginsCom\Config;
use MarcinWosinek\FairEventPluginsCom\Onboarding;

require_once __DIR__ . '/vendor/autoload.php';

Onboarding::create_account(
	$_SERVER['REQUEST_METHOD'] ?? '', // phpcs:ignore WordPress.Security.ValidatedSanitizedInput -- Compared against a literal.
	Config::from_environment( __DIR__ )
)->send();
