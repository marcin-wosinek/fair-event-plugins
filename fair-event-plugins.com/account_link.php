<?php
/**
 * POST `{ account }`: create a Stripe onboarding link. Responds with `{ url }` or `{ error }`.
 *
 * @package MarcinWosinek\FairEventPluginsCom
 */

use MarcinWosinek\FairEventPluginsCom\Config;
use MarcinWosinek\FairEventPluginsCom\Onboarding;

require_once __DIR__ . '/vendor/autoload.php';

Onboarding::create_account_link(
	$_SERVER['REQUEST_METHOD'] ?? '', // phpcs:ignore WordPress.Security.ValidatedSanitizedInput -- Compared against a literal.
	(string) file_get_contents( 'php://input' ), // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- Raw request body; validated by Onboarding.
	Config::from_environment( __DIR__ )
)->send();
