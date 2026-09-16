<?php
/**
 * AuditLogger tests — no-op suppression, redaction, and actor attribution.
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Tests\AuditLog;

use PHPUnit\Framework\TestCase;
use FairPaymentsConnector\AuditLog\AuditLogger;

/**
 * Unit tests for AuditLogger, driven black-box through its public API against
 * the Fair_Test_WPDB fake so writes are asserted without a real database.
 */
class AuditLoggerTest extends TestCase {

	/**
	 * Reset the fake $wpdb's captured rows and test globals before each test.
	 */
	protected function setUp(): void {
		parent::setUp();
		global $wpdb;
		$wpdb->inserted_rows         = array();
		$GLOBALS['_fair_test_users'] = array();
	}

	/**
	 * A safe-listed setting change retains both old and new values.
	 */
	public function test_safe_setting_change_retains_values(): void {
		AuditLogger::record_setting_change( 'fair_payment_currency', 'EUR', 'USD', 'Switching to USD pricing.', 42 );

		global $wpdb;
		$this->assertCount( 1, $wpdb->inserted_rows );
		$row = $wpdb->inserted_rows[0];
		$this->assertSame( 'setting_changed', $row['action'] );
		$this->assertSame( 'fair_payment_currency', $row['setting_key'] );
		$this->assertSame( 'EUR', $row['old_value'] );
		$this->assertSame( 'USD', $row['new_value'] );
		$this->assertSame( 0, $row['is_protected'] );
		$this->assertSame( 'Switching to USD pricing.', $row['reason'] );
	}

	/**
	 * A setting not on the safe allowlist is redacted: no values retained,
	 * but the row still proves the setting changed.
	 */
	public function test_unsafe_setting_change_is_redacted(): void {
		AuditLogger::record_setting_change( 'fair_payment_mollie_access_token', 'old_token_value', 'new_token_value', 'Mollie OAuth token rotated.', 7 );

		global $wpdb;
		$this->assertCount( 1, $wpdb->inserted_rows );
		$row = $wpdb->inserted_rows[0];
		$this->assertNull( $row['old_value'] );
		$this->assertNull( $row['new_value'] );
		$this->assertSame( 1, $row['is_protected'] );
	}

	/**
	 * No entry is written when the value did not actually change.
	 */
	public function test_no_op_setting_change_is_not_recorded(): void {
		$result = AuditLogger::record_setting_change( 'fair_payment_currency', 'EUR', 'EUR', 'No real change.', 1 );

		global $wpdb;
		$this->assertCount( 0, $wpdb->inserted_rows );
		$this->assertNull( $result );
	}

	/**
	 * A boolean setting flipping between equivalent representations
	 * (e.g. true vs '1') is still treated as unchanged.
	 */
	public function test_no_op_setting_change_normalizes_scalar_types(): void {
		AuditLogger::record_setting_change( 'fair_payment_disable_banktransfer_near_date', true, '1', 'No real change.', 1 );

		global $wpdb;
		$this->assertCount( 0, $wpdb->inserted_rows );
	}

	/**
	 * An action attributed to a known user snapshots their display name and login.
	 */
	public function test_action_attributed_to_known_user_snapshots_identity(): void {
		$GLOBALS['_fair_test_users'][5] = (object) array(
			'display_name' => 'Jane Admin',
			'user_login'   => 'jane',
		);

		AuditLogger::record_action( 'mollie_connected', 'Connecting Mollie for the first time.', 5 );

		global $wpdb;
		$row = $wpdb->inserted_rows[0];
		$this->assertSame( 5, $row['actor_user_id'] );
		$this->assertSame( 'Jane Admin', $row['actor_display_name'] );
		$this->assertSame( 'jane', $row['actor_login'] );
	}

	/**
	 * An action for a since-deleted user still records the numeric ID, with
	 * no display name to fall back on (the controller layer is responsible
	 * for the "Deleted user #N" display string).
	 */
	public function test_action_for_deleted_user_keeps_numeric_id(): void {
		AuditLogger::record_action( 'mollie_disconnected', 'Rotating credentials.', 99 );

		global $wpdb;
		$row = $wpdb->inserted_rows[0];
		$this->assertSame( 99, $row['actor_user_id'] );
		$this->assertNull( $row['actor_display_name'] );
		$this->assertNull( $row['actor_login'] );
	}

	/**
	 * A system-attributed action has no actor user ID at all.
	 */
	public function test_system_action_has_no_actor(): void {
		AuditLogger::record_system_action( 'mollie_token_refreshed', 'Automatic token refresh.' );

		global $wpdb;
		$row = $wpdb->inserted_rows[0];
		$this->assertNull( $row['actor_user_id'] );
		$this->assertNull( $row['actor_display_name'] );
	}

	/**
	 * Context values are JSON-encoded, and any credential-shaped key is
	 * dropped as defense in depth even though callers should never pass one.
	 */
	public function test_context_drops_credential_shaped_keys(): void {
		AuditLogger::record_action(
			'mollie_connected',
			'Connecting.',
			3,
			array(
				'mode'          => 'live',
				'access_token'  => 'should-never-be-logged',
				'refresh_token' => 'should-never-be-logged',
			)
		);

		global $wpdb;
		$row     = $wpdb->inserted_rows[0];
		$context = json_decode( $row['context'], true );
		$this->assertSame( array( 'mode' => 'live' ), $context );
	}
}
