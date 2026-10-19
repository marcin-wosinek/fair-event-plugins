<?php
/**
 * Onboarding endpoint tests.
 *
 * @package MarcinWosinek\FairEventPluginsCom
 */

namespace MarcinWosinek\FairEventPluginsCom\Tests;

use MarcinWosinek\FairEventPluginsCom\Config;
use MarcinWosinek\FairEventPluginsCom\Onboarding;
use PHPUnit\Framework\TestCase;
use Stripe\ApiRequestor;

/**
 * Drives the endpoints through the real StripeClient over a fake transport.
 */
class OnboardingTest extends TestCase {

	const SECRET = 'sk_test_SECRETabc123';

	/**
	 * Fake Stripe transport.
	 *
	 * @var FakeStripeHttpClient
	 */
	private $http;

	/**
	 * Server log file.
	 *
	 * @var string
	 */
	private $log_file;

	/**
	 * Previous error_log ini value.
	 *
	 * @var string|false
	 */
	private $previous_error_log;

	/**
	 * Install the fake transport and capture the server log.
	 */
	protected function setUp(): void {
		parent::setUp();
		$this->http = new FakeStripeHttpClient();
		ApiRequestor::setHttpClient( $this->http );

		$this->log_file           = (string) tempnam( sys_get_temp_dir(), 'fep-log' );
		$this->previous_error_log = ini_set( 'error_log', $this->log_file ); // phpcs:ignore WordPress.PHP.IniSet.Risky -- Capture the server log in tests.
	}

	/**
	 * Restore the SDK transport and log destination.
	 */
	protected function tearDown(): void {
		ApiRequestor::setHttpClient( null );
		ini_set( 'error_log', (string) $this->previous_error_log ); // phpcs:ignore WordPress.PHP.IniSet.Risky -- Restore the log destination.
		unlink( $this->log_file ); // phpcs:ignore WordPress.WP.AlternativeFunctions.unlink_unlink -- Not a WordPress runtime.
		parent::tearDown();
	}

	/**
	 * Configuration with valid values, overridable per test.
	 *
	 * @param array $overrides Values to replace.
	 * @return Config
	 */
	private function config( array $overrides = array() ): Config {
		return new Config(
			array_merge(
				array(
					'STRIPE_SECRET_KEY' => self::SECRET,
					'SITE_BASE_URL'     => 'https://fair-event-plugins.com/',
				),
				$overrides
			)
		);
	}

	/**
	 * Stripe-style error body.
	 *
	 * @param string $type Error type.
	 * @param string $code Error code.
	 * @return array
	 */
	private function stripe_error( string $type, string $code ): array {
		return array(
			'error' => array(
				'type'    => $type,
				'code'    => $code,
				'message' => 'Raw provider detail mentioning ' . self::SECRET,
			),
		);
	}

	/**
	 * Assert the response is a generic error that leaks nothing.
	 *
	 * @param int                                             $status   Expected status.
	 * @param \MarcinWosinek\FairEventPluginsCom\JsonResponse $response Response.
	 */
	private function assert_generic_error( int $status, $response ): void {
		$this->assertSame( $status, $response->status );
		$this->assertSame( array( 'error' ), array_keys( $response->body ) );
		$this->assertStringNotContainsString( 'SECRET', $response->body['error'] );
		$this->assertStringNotContainsString( 'provider detail', $response->body['error'] );
	}

	/**
	 * Account creation keeps the `{ account }` contract and the pinned version.
	 */
	public function test_create_account_success(): void {
		$this->http->respond(
			200,
			array(
				'id'     => 'acct_123',
				'object' => 'account',
			)
		);

		$response = Onboarding::create_account( 'POST', $this->config() );

		$this->assertSame( 200, $response->status );
		$this->assertSame( array( 'account' => 'acct_123' ), $response->body );

		$this->assertCount( 1, $this->http->requests );
		$request = $this->http->requests[0];
		$this->assertSame( 'post', $request['method'] );
		$this->assertSame( 'https://api.stripe.com/v1/accounts', $request['url'] );
		$this->assertSame( '2026-09-30.endive', $request['headers']['stripe-version'] );
		$this->assertSame( 'Bearer ' . self::SECRET, $request['headers']['authorization'] );
		$this->assertSame( array(), $request['params'] );
	}

	/**
	 * Onboarding links keep the `{ url }` contract and use the configured base URL.
	 */
	public function test_create_account_link_success(): void {
		$this->http->respond(
			200,
			array(
				'object' => 'account_link',
				'url'    => 'https://connect.stripe.com/setup/s/acct_123/abc',
			)
		);

		$response = Onboarding::create_account_link( 'POST', '{"account":"acct_123"}', $this->config() );

		$this->assertSame( 200, $response->status );
		$this->assertSame( array( 'url' => 'https://connect.stripe.com/setup/s/acct_123/abc' ), $response->body );

		$request = $this->http->requests[0];
		$this->assertSame( 'https://api.stripe.com/v1/account_links', $request['url'] );
		$this->assertSame( '2026-09-30.endive', $request['headers']['stripe-version'] );
		$this->assertSame(
			array(
				'account'     => 'acct_123',
				'return_url'  => 'https://fair-event-plugins.com/return/acct_123',
				'refresh_url' => 'https://fair-event-plugins.com/refresh/acct_123',
				'type'        => 'account_onboarding',
			),
			$request['params']
		);
	}

	/**
	 * Only POST is accepted, before any provider call.
	 */
	public function test_non_post_methods_are_rejected(): void {
		$account = Onboarding::create_account( 'GET', $this->config() );
		$link    = Onboarding::create_account_link( 'GET', '{"account":"acct_123"}', $this->config() );

		foreach ( array( $account, $link ) as $response ) {
			$this->assertSame( 405, $response->status );
			$this->assertSame( array( 'Allow' => 'POST' ), $response->headers );
		}
		$this->assertCount( 0, $this->http->requests );
	}

	/**
	 * Malformed bodies and account IDs are rejected before any provider call.
	 *
	 * @dataProvider invalid_link_bodies
	 *
	 * @param string $body Raw request body.
	 */
	public function test_invalid_link_input_is_rejected( string $body ): void {
		$response = Onboarding::create_account_link( 'POST', $body, $this->config() );

		$this->assert_generic_error( 400, $response );
		$this->assertCount( 0, $this->http->requests );
	}

	/**
	 * Invalid request bodies.
	 *
	 * @return array
	 */
	public function invalid_link_bodies(): array {
		return array(
			'empty body'      => array( '' ),
			'malformed json'  => array( '{"account":' ),
			'json scalar'     => array( '"acct_123"' ),
			'missing account' => array( '{}' ),
			'null account'    => array( '{"account":null}' ),
			'numeric account' => array( '{"account":123}' ),
			'wrong prefix'    => array( '{"account":"cus_123"}' ),
			'path traversal'  => array( '{"account":"acct_123/../x"}' ),
			'url injection'   => array( '{"account":"acct_123?x=https://evil.test"}' ),
		);
	}

	/**
	 * Missing configuration fails inside the JSON boundary without a provider call.
	 */
	public function test_missing_secret_key_returns_generic_error(): void {
		$account = Onboarding::create_account( 'POST', $this->config( array( 'STRIPE_SECRET_KEY' => '' ) ) );
		$link    = Onboarding::create_account_link( 'POST', '{"account":"acct_123"}', $this->config( array( 'STRIPE_SECRET_KEY' => '' ) ) );

		$this->assert_generic_error( 500, $account );
		$this->assert_generic_error( 500, $link );
		$this->assertCount( 0, $this->http->requests );
	}

	/**
	 * An invalid base URL fails before the onboarding link is requested.
	 */
	public function test_invalid_site_base_url_returns_generic_error(): void {
		$response = Onboarding::create_account_link( 'POST', '{"account":"acct_123"}', $this->config( array( 'SITE_BASE_URL' => 'http://example.com' ) ) );

		$this->assert_generic_error( 500, $response );
		$this->assertCount( 0, $this->http->requests );
		$this->assertStringContainsString( 'SITE_BASE_URL', (string) file_get_contents( $this->log_file ) ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- Test log file.
	}

	/**
	 * An unknown connected account maps to 404.
	 */
	public function test_unknown_account_returns_not_found(): void {
		$this->http->respond( 400, $this->stripe_error( 'invalid_request_error', 'resource_missing' ) );

		$response = Onboarding::create_account_link( 'POST', '{"account":"acct_missing"}', $this->config() );

		$this->assert_generic_error( 404, $response );
		$log = (string) file_get_contents( $this->log_file ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- Test log file.
		$this->assertStringContainsString( 'resource_missing', $log );
		$this->assertStringContainsString( 'req_fake', $log );
	}

	/**
	 * Provider failures map to a generic 502.
	 *
	 * @dataProvider provider_failures
	 *
	 * @param int    $status HTTP status from Stripe.
	 * @param string $type   Error type.
	 * @param string $code   Error code.
	 */
	public function test_provider_failures_return_generic_error( int $status, string $type, string $code ): void {
		$this->http->respond( $status, $this->stripe_error( $type, $code ) );
		$this->http->respond( $status, $this->stripe_error( $type, $code ) );

		$this->assert_generic_error( 502, Onboarding::create_account( 'POST', $this->config() ) );
		$this->assert_generic_error( 502, Onboarding::create_account_link( 'POST', '{"account":"acct_123"}', $this->config() ) );
	}

	/**
	 * Provider failures.
	 *
	 * @return array
	 */
	public function provider_failures(): array {
		return array(
			'authentication' => array( 401, 'invalid_request_error', 'api_key_expired' ),
			'permission'     => array( 403, 'invalid_request_error', 'secret_key_required' ),
			'invalid params' => array( 400, 'invalid_request_error', 'parameter_invalid_empty' ),
			'rate limit'     => array( 429, 'invalid_request_error', 'rate_limit' ),
			'server error'   => array( 500, 'api_error', '' ),
		);
	}

	/**
	 * A transport failure maps to a generic 502.
	 */
	public function test_connection_failure_returns_generic_error(): void {
		ApiRequestor::setHttpClient(
			new class() extends FakeStripeHttpClient {
				/**
				 * Simulate a network failure.
				 *
				 * @param mixed ...$args Ignored.
				 * @throws \Stripe\Exception\ApiConnectionException Always.
				 */
				public function request( ...$args ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.Found
					throw new \Stripe\Exception\ApiConnectionException( 'Could not connect' );
				}
			}
		);

		$this->assert_generic_error( 502, Onboarding::create_account( 'POST', $this->config() ) );
	}
}
