<?php
/**
 * Opt-in Stripe test-mode smoke check for the onboarding endpoints.
 *
 * Calls the real Stripe test API through the same code as account.php and
 * account_link.php. Refuses to run with anything but a test-mode key.
 *
 *     composer smoke:stripe-test                      # new account + link
 *     composer smoke:stripe-test -- acct_existing     # also link an existing test account
 *     composer smoke:stripe-test -- --delete acct_…   # delete test accounts afterwards
 *
 * @package MarcinWosinek\FairEventPluginsCom
 */

if ( 'cli' !== PHP_SAPI ) {
	http_response_code( 404 );
	exit;
}

require_once dirname( __DIR__ ) . '/vendor/autoload.php';

use MarcinWosinek\FairEventPluginsCom\Config;
use MarcinWosinek\FairEventPluginsCom\Onboarding;

$fep_config = Config::from_environment( dirname( __DIR__ ) );

if ( ! $fep_config->is_test_mode() ) {
	fwrite( STDERR, "Refusing to run: STRIPE_SECRET_KEY is not a Stripe test-mode key (sk_test_… / rk_test_…).\n" ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fwrite
	exit( 2 );
}

$fep_args = array_slice( $argv, 1 );

if ( isset( $fep_args[0] ) && '--delete' === $fep_args[0] ) {
	$fep_client = $fep_config->stripe_client();
	foreach ( array_slice( $fep_args, 1 ) as $fep_account ) {
		$fep_client->accounts->delete( $fep_account );
		echo "Deleted test account {$fep_account}\n"; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- CLI output.
	}
	exit( 0 );
}

/**
 * Print a step result and exit on failure.
 *
 * @param string                                          $step     Step name.
 * @param \MarcinWosinek\FairEventPluginsCom\JsonResponse $response Endpoint response.
 * @param int                                             $expected Expected status.
 */
function fep_smoke_report( string $step, $response, int $expected = 200 ): void {
	$ok = $expected === $response->status;
	printf( "%s %s: HTTP %d %s\n", $ok ? 'PASS' : 'FAIL', $step, $response->status, json_encode( $response->body ) ); // phpcs:ignore WordPress.WP.AlternativeFunctions.json_encode_json_encode, WordPress.Security.EscapeOutput.OutputNotEscaped -- CLI output.
	if ( ! $ok ) {
		exit( 1 );
	}
}

$fep_created = Onboarding::create_account( 'POST', $fep_config );
fep_smoke_report( 'create account', $fep_created );
$fep_new_account = $fep_created->body['account'];

fep_smoke_report( 'onboarding link (new account)', Onboarding::create_account_link( 'POST', json_encode( array( 'account' => $fep_new_account ) ), $fep_config ) ); // phpcs:ignore WordPress.WP.AlternativeFunctions.json_encode_json_encode

// A second link for the same account, as the /refresh/{account} callback requests.
fep_smoke_report( 'fresh link (refresh)', Onboarding::create_account_link( 'POST', json_encode( array( 'account' => $fep_new_account ) ), $fep_config ) ); // phpcs:ignore WordPress.WP.AlternativeFunctions.json_encode_json_encode

foreach ( $fep_args as $fep_existing ) {
	fep_smoke_report( "onboarding link (existing {$fep_existing})", Onboarding::create_account_link( 'POST', json_encode( array( 'account' => $fep_existing ) ), $fep_config ) ); // phpcs:ignore WordPress.WP.AlternativeFunctions.json_encode_json_encode
}

fep_smoke_report( 'unknown account', Onboarding::create_account_link( 'POST', '{"account":"acct_doesnotexist000"}', $fep_config ), 404 );
fep_smoke_report( 'invalid account id', Onboarding::create_account_link( 'POST', '{"account":"cus_123"}', $fep_config ), 400 );

$fep_account = $fep_config->stripe_client()->accounts->retrieve( $fep_new_account );
printf(
	"Account %s: type=%s controller=%s\n",
	$fep_account->id, // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- CLI output.
	$fep_account->type ?? 'n/a', // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- CLI output.
	json_encode( $fep_account->controller ?? null ) // phpcs:ignore WordPress.WP.AlternativeFunctions.json_encode_json_encode, WordPress.Security.EscapeOutput.OutputNotEscaped -- CLI output.
);
echo "Clean up: composer smoke:stripe-test -- --delete {$fep_new_account}\n"; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- CLI output.
