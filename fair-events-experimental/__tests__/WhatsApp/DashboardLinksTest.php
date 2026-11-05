<?php
/**
 * App Dashboard link resolution tests.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Tests\WhatsApp;

use FairEventsExperimental\WhatsApp\Configuration;
use FairEventsExperimental\WhatsApp\Connector;
use FairEventsExperimental\WhatsApp\DashboardLinks;
use PHPUnit\Framework\TestCase;

/**
 * Covers partial success, malformed IDs, cache lifetimes and invalidation
 * when the token or the account changes.
 */
class DashboardLinksTest extends TestCase {
	private const TOKEN    = 'EAAGdashboardLinksToken0123456789abcdef';
	private const OTHER    = 'EAAGdashboardLinksOther9876543210zyxwvu';
	private const WABA     = '100000000000001';
	private const APP      = '555000000000001';
	private const BUSINESS = '777000000000001';

	private const BASIC   = 'https://developers.facebook.com/apps/555000000000001/settings/basic/';
	private const WEBHOOK = 'https://developers.facebook.com/apps/555000000000001/use_cases/customize/wa-settings/?use_case_enum=WHATSAPP_BUSINESS_MESSAGING&product_route=whatsapp-business&business_id=777000000000001&selected_tab=wa-settings';

	/** Start with nothing saved, cached or queued. */
	protected function setUp(): void {
		$GLOBALS['_fair_test_options']              = array();
		$GLOBALS['_fair_test_transients']           = array();
		$GLOBALS['_fair_test_remote_get_requests']  = array();
		$GLOBALS['_fair_test_remote_get_responses'] = array();
		putenv( Connector::CREDENTIAL_NAME ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.runtime_configuration_putenv -- test-only environment.
	}

	/** Leave nothing behind for other suites. */
	protected function tearDown(): void {
		$GLOBALS['_fair_test_transients']           = array();
		$GLOBALS['_fair_test_remote_get_responses'] = array();
		putenv( Connector::CREDENTIAL_NAME ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.runtime_configuration_putenv -- test-only environment.
	}

	/**
	 * A simulated response.
	 *
	 * @param int   $status HTTP status.
	 * @param array $body   Body.
	 * @return array
	 */
	private static function answer( $status, array $body ) {
		return array(
			'response' => array( 'code' => $status ),
			'body'     => wp_json_encode( $body ),
		);
	}

	/**
	 * Meta's app answer.
	 *
	 * @return array
	 */
	private static function app() {
		return self::answer( 200, array( 'id' => self::APP ) );
	}

	/**
	 * Meta's account answer with its owner.
	 *
	 * @return array
	 */
	private static function owner() {
		return self::answer( 200, array( 'owner_business_info' => array( 'id' => self::BUSINESS ) ) );
	}

	/**
	 * Meta's permission error.
	 *
	 * @return array
	 */
	private static function denied() {
		return self::answer( 403, array( 'error' => array( 'code' => 200 ) ) );
	}

	/**
	 * Save the token and account.
	 *
	 * @param string $token Token.
	 * @param string $waba  Account ID.
	 * @return void
	 */
	private static function configure( $token = self::TOKEN, $waba = self::WABA ) {
		$GLOBALS['_fair_test_options'][ Connector::TOKEN_OPTION ] = $token;
		Configuration::save( $waba, '200000000000002' );
	}

	/**
	 * Queue answers for the next GET requests.
	 *
	 * @param array ...$responses Answers, in order.
	 * @return void
	 */
	private static function queue( ...$responses ) {
		$GLOBALS['_fair_test_remote_get_responses'] = $responses;
	}

	/**
	 * Requests sent to Meta so far.
	 *
	 * @return int
	 */
	private static function requests() {
		return count( $GLOBALS['_fair_test_remote_get_requests'] );
	}

	/** Both links are built from the resolved IDs. */
	public function test_both_links() {
		self::configure();
		self::queue( self::app(), self::owner() );

		$this->assertSame(
			array(
				'app_settings_url'          => self::BASIC,
				'webhook_configuration_url' => self::WEBHOOK,
			),
			DashboardLinks::resolve()
		);
	}

	/** Without a token or a valid account, Meta is not contacted. */
	public function test_nothing_without_configuration() {
		$none = array(
			'app_settings_url'          => null,
			'webhook_configuration_url' => null,
		);
		$this->assertSame( $none, DashboardLinks::resolve() );

		Configuration::save( self::WABA, '' );
		$this->assertSame( $none, DashboardLinks::resolve() );

		$GLOBALS['_fair_test_options'][ Connector::TOKEN_OPTION ] = self::TOKEN;
		Configuration::save( '', '' );
		$this->assertSame( $none, DashboardLinks::resolve() );

		$this->assertSame( 0, self::requests() );
	}

	/** A failed business lookup keeps the Basic settings link. */
	public function test_business_failure_keeps_the_app_link() {
		self::configure();
		self::queue( self::app(), self::denied() );

		$this->assertSame(
			array(
				'app_settings_url'          => self::BASIC,
				'webhook_configuration_url' => null,
			),
			DashboardLinks::resolve()
		);
		$this->assertSame( DashboardLinks::SUCCESS_TTL, $GLOBALS['_fair_test_transients'][ DashboardLinks::APP_TRANSIENT ]['expiration'] );
		$this->assertSame( DashboardLinks::FAILURE_TTL, $GLOBALS['_fair_test_transients'][ DashboardLinks::BUSINESS_TRANSIENT ]['expiration'] );
	}

	/** A failed or malformed app lookup gives no link and no business lookup. */
	public function test_app_failure_gives_no_link() {
		self::configure();
		self::queue( self::answer( 200, array( 'id' => '12a' ) ) );

		$this->assertSame(
			array(
				'app_settings_url'          => null,
				'webhook_configuration_url' => null,
			),
			DashboardLinks::resolve()
		);
		$this->assertSame( 1, self::requests() );
		$this->assertSame( DashboardLinks::FAILURE_TTL, $GLOBALS['_fair_test_transients'][ DashboardLinks::APP_TRANSIENT ]['expiration'] );
		$this->assertSame( 300, DashboardLinks::FAILURE_TTL );
		$this->assertSame( DAY_IN_SECONDS, DashboardLinks::SUCCESS_TTL );
	}

	/** Cached results, including failures, are reused without asking Meta. */
	public function test_results_are_cached() {
		self::configure();
		self::queue( self::app(), self::denied() );
		DashboardLinks::resolve();
		$this->assertSame( 2, self::requests() );

		$links = DashboardLinks::resolve();

		$this->assertSame( 2, self::requests() );
		$this->assertSame( self::BASIC, $links['app_settings_url'] );
		$this->assertNull( $links['webhook_configuration_url'] );
	}

	/** The cache never stores the token. */
	public function test_cache_does_not_store_the_token() {
		self::configure();
		self::queue( self::app(), self::owner() );
		DashboardLinks::resolve();

		$this->assertStringNotContainsString( self::TOKEN, (string) wp_json_encode( $GLOBALS['_fair_test_transients'] ) );
	}

	/** Another token resolves both IDs again. */
	public function test_token_change_invalidates() {
		self::configure();
		self::queue( self::app(), self::owner() );
		DashboardLinks::resolve();

		$GLOBALS['_fair_test_options'][ Connector::TOKEN_OPTION ] = self::OTHER;
		self::queue( self::answer( 200, array( 'id' => '555000000000009' ) ), self::denied() );
		$links = DashboardLinks::resolve();

		$this->assertSame( 4, self::requests() );
		$this->assertSame( 'https://developers.facebook.com/apps/555000000000009/settings/basic/', $links['app_settings_url'] );
		$this->assertNull( $links['webhook_configuration_url'] );
	}

	/** An environment override counts as another token. */
	public function test_environment_override_invalidates() {
		self::configure();
		self::queue( self::app(), self::owner() );
		DashboardLinks::resolve();

		putenv( Connector::CREDENTIAL_NAME . '=' . self::OTHER ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.runtime_configuration_putenv -- test-only environment.
		self::queue( self::denied() );
		$links = DashboardLinks::resolve();

		$this->assertSame( 3, self::requests() );
		$this->assertNull( $links['app_settings_url'] );
	}

	/** Another account resolves only its owner again. */
	public function test_account_change_invalidates_the_business() {
		self::configure();
		self::queue( self::app(), self::owner() );
		DashboardLinks::resolve();

		self::configure( self::TOKEN, '100000000000002' );
		self::queue( self::denied() );
		$links = DashboardLinks::resolve();

		$this->assertSame( 3, self::requests() );
		$this->assertStringEndsWith( '/100000000000002?fields=owner_business_info', $GLOBALS['_fair_test_remote_get_requests'][2]['url'] );
		$this->assertSame( self::BASIC, $links['app_settings_url'] );
		$this->assertNull( $links['webhook_configuration_url'] );
	}
}
