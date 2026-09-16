<?php
/**
 * PaymentSetupNotice readiness, page scope, and capability tests.
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Tests\Admin;

use PHPUnit\Framework\TestCase;
use FairPaymentsConnector\Admin\PaymentSetupNotice;

/**
 * Unit tests for PaymentSetupNotice.
 */
class PaymentSetupNoticeTest extends TestCase {

	/**
	 * Reset the fakes each test relies on.
	 */
	protected function setUp(): void {
		parent::setUp();
		$GLOBALS['_fair_test_options']          = array();
		$GLOBALS['_fair_test_current_user_can'] = false;
		$GLOBALS['_fair_test_admin_notices']    = array();
		$GLOBALS['_fair_test_current_screen']   = null;
		unset( $_GET['page'] );
	}

	/** No Mollie connection at all is the connection-warning state. */
	public function test_readiness_state_not_connected_without_mollie_connection() {
		$this->assertSame( 'not_connected', PaymentSetupNotice::readiness_state() );
	}

	/** Connected but missing a profile ID is incomplete, even in live mode. */
	public function test_readiness_state_incomplete_when_profile_id_missing() {
		$GLOBALS['_fair_test_options']['fair_payment_mollie_connected'] = true;
		$GLOBALS['_fair_test_options']['fair_payment_mode']             = 'live';

		$this->assertSame( 'incomplete', PaymentSetupNotice::readiness_state() );
	}

	/** Connected with a profile ID but still in test mode is incomplete. */
	public function test_readiness_state_incomplete_when_still_in_test_mode() {
		$GLOBALS['_fair_test_options']['fair_payment_mollie_connected']  = true;
		$GLOBALS['_fair_test_options']['fair_payment_mollie_profile_id'] = 'pfl_test123';
		$GLOBALS['_fair_test_options']['fair_payment_mode']              = 'test';

		$this->assertSame( 'incomplete', PaymentSetupNotice::readiness_state() );
	}

	/** Connected, with a profile ID, in live mode is ready — no warning. */
	public function test_readiness_state_ready_when_connected_with_profile_in_live_mode() {
		$GLOBALS['_fair_test_options']['fair_payment_mollie_connected']  = true;
		$GLOBALS['_fair_test_options']['fair_payment_mollie_profile_id'] = 'pfl_test123';
		$GLOBALS['_fair_test_options']['fair_payment_mode']              = 'live';

		$this->assertSame( 'ready', PaymentSetupNotice::readiness_state() );
	}

	/** A page slug prefixed fair- is in scope, including hidden connector pages. */
	public function test_is_suite_admin_page_matches_fair_prefixed_page_slug() {
		$_GET['page'] = 'fair-payments-connector-transaction';
		$this->assertTrue( PaymentSetupNotice::is_suite_admin_page() );
	}

	/** The shared Settings -> Fair Event Plugins page is in scope. */
	public function test_is_suite_admin_page_matches_shared_settings_page() {
		$_GET['page'] = 'fair-event-plugins';
		$this->assertTrue( PaymentSetupNotice::is_suite_admin_page() );
	}

	/** A fair_event list/editor screen is in scope via get_current_screen(). */
	public function test_is_suite_admin_page_matches_fair_event_post_type_screen() {
		$GLOBALS['_fair_test_current_screen'] = (object) array( 'post_type' => 'fair_event' );
		$this->assertTrue( PaymentSetupNotice::is_suite_admin_page() );
	}

	/** An ordinary WordPress page, including another post type's editor, is out of scope. */
	public function test_is_suite_admin_page_excludes_unrelated_post_type_screen() {
		$GLOBALS['_fair_test_current_screen'] = (object) array( 'post_type' => 'page' );
		$this->assertFalse( PaymentSetupNotice::is_suite_admin_page() );
	}

	/** An unrelated WordPress admin page (no page arg, no matching screen) is out of scope. */
	public function test_is_suite_admin_page_excludes_page_with_no_page_arg_or_screen() {
		$this->assertFalse( PaymentSetupNotice::is_suite_admin_page() );
	}

	/** No notice renders for a user who cannot manage payment settings. */
	public function test_maybe_show_notice_skips_users_without_capability() {
		$_GET['page']                           = 'fair-payments-connector-settings';
		$GLOBALS['_fair_test_current_user_can'] = false;

		( new PaymentSetupNotice() )->maybe_show_notice();

		$this->assertSame( array(), $GLOBALS['_fair_test_admin_notices'] );
	}

	/** No notice renders on a page outside the suite, even for a capable user. */
	public function test_maybe_show_notice_skips_pages_outside_the_suite() {
		$_GET['page']                           = 'some-other-plugin';
		$GLOBALS['_fair_test_current_user_can'] = true;

		( new PaymentSetupNotice() )->maybe_show_notice();

		$this->assertSame( array(), $GLOBALS['_fair_test_admin_notices'] );
	}

	/** No notice renders once the connector is fully ready. */
	public function test_maybe_show_notice_skips_when_ready() {
		$_GET['page']                           = 'fair-events-calendar';
		$GLOBALS['_fair_test_current_user_can'] = true;
		$GLOBALS['_fair_test_options']['fair_payment_mollie_connected']  = true;
		$GLOBALS['_fair_test_options']['fair_payment_mollie_profile_id'] = 'pfl_test123';
		$GLOBALS['_fair_test_options']['fair_payment_mode']              = 'live';

		( new PaymentSetupNotice() )->maybe_show_notice();

		$this->assertSame( array(), $GLOBALS['_fair_test_admin_notices'] );
	}

	/** A capable user on a sibling plugin's suite page sees the connection warning, non-dismissibly. */
	public function test_maybe_show_notice_renders_connection_warning_on_sibling_plugin_page() {
		$_GET['page']                           = 'fair-events-calendar';
		$GLOBALS['_fair_test_current_user_can'] = true;

		( new PaymentSetupNotice() )->maybe_show_notice();

		$this->assertCount( 1, $GLOBALS['_fair_test_admin_notices'] );
		$notice = $GLOBALS['_fair_test_admin_notices'][0];
		$this->assertStringContainsString( 'not connected to Mollie', $notice['message'] );
		$this->assertStringContainsString( 'fair-payments-connector-settings', $notice['message'] );
		$this->assertFalse( $notice['args']['dismissible'] );
		$this->assertSame( 'warning', $notice['args']['type'] );
	}

	/** The incomplete-setup message is distinct from the connection message. */
	public function test_maybe_show_notice_renders_incomplete_warning_when_connected_but_not_ready() {
		$_GET['page']                           = 'fair-payments-connector-transactions';
		$GLOBALS['_fair_test_current_user_can'] = true;
		$GLOBALS['_fair_test_options']['fair_payment_mollie_connected']  = true;
		$GLOBALS['_fair_test_options']['fair_payment_mollie_profile_id'] = '';
		$GLOBALS['_fair_test_options']['fair_payment_mode']              = 'live';

		( new PaymentSetupNotice() )->maybe_show_notice();

		$this->assertCount( 1, $GLOBALS['_fair_test_admin_notices'] );
		$this->assertStringContainsString( 'setup is incomplete', $GLOBALS['_fair_test_admin_notices'][0]['message'] );
	}

	/** The rendered message never leaks stored credential-like values. */
	public function test_maybe_show_notice_never_includes_sensitive_option_values() {
		$_GET['page']                           = 'fair-events-calendar';
		$GLOBALS['_fair_test_current_user_can'] = true;
		$GLOBALS['_fair_test_options']['fair_payment_mollie_connected']     = true;
		$GLOBALS['_fair_test_options']['fair_payment_mollie_profile_id']    = 'pfl_secret';
		$GLOBALS['_fair_test_options']['fair_payment_mode']                 = 'test';
		$GLOBALS['_fair_test_options']['fair_payment_mollie_access_token']  = 'sk_live_secret_token';
		$GLOBALS['_fair_test_options']['fair_payment_mollie_refresh_token'] = 'refresh_secret_token';

		( new PaymentSetupNotice() )->maybe_show_notice();

		$message = $GLOBALS['_fair_test_admin_notices'][0]['message'];
		$this->assertStringNotContainsString( 'pfl_secret', $message );
		$this->assertStringNotContainsString( 'secret_token', $message );
	}
}
