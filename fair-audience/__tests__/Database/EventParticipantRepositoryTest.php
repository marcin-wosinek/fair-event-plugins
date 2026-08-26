<?php
/**
 * EventParticipantRepository expiry tests.
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Database;

use FairAudience\Database\EventParticipantRepository;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/ExpiryWPDB.php';

/**
 * Verifies audience-backed holds use UTC at repository boundaries.
 */
class EventParticipantRepositoryTest extends TestCase {
	/**
	 * Database double.
	 *
	 * @var Expiry_WPDB
	 */
	private $database;

	/**
	 * Install a fresh database double.
	 */
	protected function setUp(): void {
		parent::setUp();
		$this->database = new Expiry_WPDB();
		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- test-only fake.
		$GLOBALS['wpdb'] = $this->database;
	}

	/**
	 * Capacity comparisons remain UTC in all representative site timezones.
	 *
	 * @dataProvider timezone_provider
	 *
	 * @param string $timezone Timezone under test.
	 */
	public function test_capacity_comparison_uses_utc( string $timezone ): void {
		$GLOBALS['_fair_test_timezone'] = $timezone;
		$this->database->rows[1]        = (object) array(
			'id'                 => 1,
			'event_date_id'      => 50,
			'participant_id'     => 70,
			'label'              => 'pending_payment',
			'payment_expires_at' => gmdate( 'Y-m-d H:i:s', time() + 60 ),
		);

		$this->assertSame( 1, ( new EventParticipantRepository() )->count_active_for_event_date( 50 ) );
		$this->assertSame( gmdate( 'Y-m-d H:i:s' ), $this->database->last_prepared['args'][2] );
	}

	/**
	 * Capacity stops counting at expiry and cleanup deletes at/after expiry.
	 */
	public function test_capacity_and_cleanup_share_exact_expiry_boundary(): void {
		$now                  = gmdate( 'Y-m-d H:i:s' );
		$this->database->rows = array(
			1 => (object) array(
				'id'                 => 1,
				'event_date_id'      => 50,
				'participant_id'     => 71,
				'label'              => 'pending_payment',
				'payment_expires_at' => gmdate( 'Y-m-d H:i:s', time() + 60 ),
			),
			2 => (object) array(
				'id'                 => 2,
				'event_date_id'      => 50,
				'participant_id'     => 72,
				'label'              => 'pending_payment',
				'payment_expires_at' => $now,
			),
			3 => (object) array(
				'id'                 => 3,
				'event_date_id'      => 50,
				'participant_id'     => 73,
				'label'              => 'pending_payment',
				'payment_expires_at' => gmdate( 'Y-m-d H:i:s', time() - 60 ),
			),
		);
		$repository           = new EventParticipantRepository();

		$this->assertSame( 1, $repository->count_active_for_event_date( 50 ) );
		$this->assertSame( 2, $repository->delete_expired_pending_payments() );
		$this->assertArrayHasKey( 1, $this->database->rows );
		$this->assertArrayNotHasKey( 2, $this->database->rows );
		$this->assertArrayNotHasKey( 3, $this->database->rows );
	}

	/**
	 * Representative timezones, including DST-observing offsets.
	 *
	 * @return array<string, array{string}>
	 */
	public function timezone_provider(): array {
		return array(
			'UTC'             => array( 'UTC' ),
			'positive DST'    => array( 'Europe/Brussels' ),
			'negative offset' => array( 'America/New_York' ),
		);
	}
}
