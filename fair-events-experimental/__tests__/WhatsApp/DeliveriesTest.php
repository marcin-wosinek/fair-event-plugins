<?php
/**
 * WhatsApp delivery outcome tests.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Tests\WhatsApp;

use FairEventsExperimental\WhatsApp\Deliveries;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Covers how a stored send and its delivery evidence read as one outcome.
 */
class DeliveriesTest extends TestCase {
	/**
	 * Rows and the outcome they read as.
	 *
	 * @return array
	 */
	public static function rows() {
		$accepted = array(
			'send_outcome' => 'accepted',
			'status_rank'  => 0,
			'failed_at'    => null,
		);
		return array(
			'accepted, no update yet' => array( $accepted, 'accepted' ),
			'sent'                    => array( array_merge( $accepted, array( 'status_rank' => 1 ) ), 'sent' ),
			'delivered'               => array( array_merge( $accepted, array( 'status_rank' => 2 ) ), 'delivered' ),
			'read'                    => array( array_merge( $accepted, array( 'status_rank' => 3 ) ), 'read' ),
			'failed'                  => array( array_merge( $accepted, array( 'failed_at' => '2026-10-29 08:00:00' ) ), 'failed' ),
			'sent, then failed'       => array(
				array_merge(
					$accepted,
					array(
						'status_rank' => 1,
						'failed_at'   => '2026-10-29 08:00:00',
					)
				),
				'failed',
			),
			'failure, then delivered' => array(
				array_merge(
					$accepted,
					array(
						'status_rank' => 2,
						'failed_at'   => '2026-10-29 08:00:00',
					)
				),
				'delivered',
			),
			'failure, then read'      => array(
				array_merge(
					$accepted,
					array(
						'status_rank' => 3,
						'failed_at'   => '2026-10-29 08:00:00',
					)
				),
				'read',
			),
			'not accepted'            => array( array( 'send_outcome' => 'not_accepted' ), 'not_accepted' ),
			'timed out'               => array( array( 'send_outcome' => 'uncertain' ), 'uncertain' ),
			'result never recorded'   => array( array( 'send_outcome' => '' ), 'uncertain' ),
		);
	}

	/**
	 * Acceptance stays apart from delivery; delivered or read wins over a failure.
	 *
	 * @param array  $row     Delivery row.
	 * @param string $outcome Expected outcome.
	 */
	#[DataProvider( 'rows' )]
	public function test_outcome( array $row, $outcome ) {
		$this->assertSame( $outcome, Deliveries::outcome( $row ) );
	}

	/** Only allowlisted failure codes are kept. */
	public function test_failure_code_allowlist() {
		$this->assertSame( 131026, Deliveries::failure_code( 131026 ) );
		$this->assertSame( 0, Deliveries::failure_code( 999999 ) );
		$this->assertSame( 0, Deliveries::failure_code( '131026' ) );
		$this->assertSame( 0, Deliveries::failure_code( null ) );
	}
}
