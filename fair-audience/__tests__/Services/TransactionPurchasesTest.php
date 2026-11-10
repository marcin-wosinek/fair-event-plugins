<?php
/**
 * Tests for the purchases a payment notification describes.
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Services;

use FairAudience\Services\TransactionPurchases;
use PHPUnit\Framework\TestCase;

/**
 * Covers TransactionPurchases (#2250).
 */
class TransactionPurchasesTest extends TestCase {

	/**
	 * Calls made to the injected lookups, by name.
	 *
	 * @var array<string, array>
	 */
	private $calls = array();

	/**
	 * A resolver whose lookups record their calls and answer from fixtures.
	 *
	 * @param bool  $readers_active Whether Fair Events' readers answer.
	 * @param array $fixtures       linked, signups (signup ID => purchase), latest, ledger.
	 * @return TransactionPurchases
	 */
	private function resolver( $readers_active, array $fixtures ) {
		$this->calls = array(
			'linked'  => array(),
			'signups' => array(),
			'latest'  => array(),
			'ledger'  => array(),
		);

		return new TransactionPurchases(
			$readers_active,
			function ( $transaction_id ) use ( $fixtures ) {
				$this->calls['linked'][] = $transaction_id;
				return $fixtures['linked'] ?? array();
			},
			function ( array $signup_ids ) use ( $fixtures ) {
				$this->calls['signups'][] = $signup_ids;
				$purchases                = array();
				foreach ( $signup_ids as $signup_id ) {
					if ( ! isset( $fixtures['signups'][ $signup_id ] ) ) {
						return array();
					}
					$purchases[] = $fixtures['signups'][ $signup_id ];
				}
				return $purchases;
			},
			function ( $transaction_id ) use ( $fixtures ) {
				$this->calls['latest'][] = $transaction_id;
				return $fixtures['latest'] ?? array();
			},
			function ( $transaction_id ) use ( $fixtures ) {
				$this->calls['ledger'][] = $transaction_id;
				return $fixtures['ledger'] ?? array();
			}
		);
	}

	/**
	 * A purchase or relationship row.
	 *
	 * @param int $ticket_type_id Ticket type ID.
	 * @param int $participant_id Purchaser.
	 * @param int $event_id       Event post ID.
	 * @return object
	 */
	private static function purchase( $ticket_type_id, $participant_id = 19, $event_id = 71 ) {
		return (object) array(
			'event_id'       => $event_id,
			'event_date_id'  => 1,
			'participant_id' => $participant_id,
			'ticket_type_id' => $ticket_type_id,
			'activity_rows'  => array(),
		);
	}

	/**
	 * The reported case: before the readers are active, a participant who
	 * already held a ticket for the date buys another type. The ledger links
	 * the new payment to their shared relationship, which still carries the
	 * earlier ticket type; the notification must name the purchase the
	 * transaction's metadata names instead.
	 *
	 * @return void
	 */
	public function test_get_tickets_payment_names_its_own_purchase_not_the_shared_relationship() {
		$earlier_ticket_type = 2;
		$bought_ticket_type  = 20;

		$purchases = $this->resolver(
			false,
			array(
				'signups' => array( 82 => self::purchase( $bought_ticket_type ) ),
				'ledger'  => array( self::purchase( $earlier_ticket_type ) ),
			)
		)->for_transaction(
			80,
			array(
				'source'        => 'fair-events-get-tickets',
				'event_date_id' => 1,
				'signup_id'     => 82,
			)
		);

		$this->assertSame( array( $bought_ticket_type ), TransactionPurchases::summary( $purchases )['ticket_type_ids'] );
		$this->assertSame( array( array( 82 ) ), $this->calls['signups'] );
		$this->assertSame( array(), $this->calls['ledger'], 'The shared relationship is never read for a get-tickets payment.' );
	}

	/**
	 * A shared checkout names every purchase; each ticket type is listed once.
	 *
	 * @return void
	 */
	public function test_shared_checkout_lists_every_purchase() {
		$purchases = $this->resolver(
			false,
			array(
				'signups' => array(
					90 => self::purchase( 20 ),
					91 => self::purchase( 21 ),
					92 => self::purchase( 20 ),
				),
			)
		)->for_transaction(
			81,
			array(
				'source'     => 'fair-events-get-tickets',
				'signup_ids' => array( 90, '91', 92 ),
			)
		);

		$summary = TransactionPurchases::summary( $purchases );
		$this->assertSame( array( 20, 21 ), $summary['ticket_type_ids'] );
		$this->assertSame( 71, $summary['event_id'] );
		$this->assertSame( 19, $summary['participant_id'] );
	}

	/**
	 * A purchase that no longer exists leaves the payment unresolved: no
	 * ticket type at all, and no fall back to the ledger.
	 *
	 * @return void
	 */
	public function test_missing_purchase_resolves_nothing() {
		$purchases = $this->resolver(
			false,
			array(
				'signups' => array( 90 => self::purchase( 20 ) ),
				'ledger'  => array( self::purchase( 2 ) ),
			)
		)->for_transaction(
			81,
			array(
				'source'     => 'fair-events-get-tickets',
				'signup_ids' => array( 90, 404 ),
			)
		);

		$this->assertSame( array(), $purchases );
		$this->assertSame( array(), $this->calls['ledger'] );
	}

	/**
	 * Malformed metadata is not evidence; nothing is looked up.
	 *
	 * @return void
	 */
	public function test_malformed_signup_ids_resolve_nothing() {
		foreach ( array( array( 'signup_ids' => 'x' ), array( 'signup_ids' => array( 90, 'abc' ) ), array( 'signup_id' => 0 ) ) as $keys ) {
			$purchases = $this->resolver(
				false,
				array(
					'signups' => array( 90 => self::purchase( 20 ) ),
					'latest'  => array( 90 ),
					'ledger'  => array( self::purchase( 2 ) ),
				)
			)->for_transaction( 81, array( 'source' => 'fair-events-get-tickets' ) + $keys );

			$this->assertSame( array(), $purchases );
			$this->assertSame( array(), $this->calls['signups'] );
			$this->assertSame( array(), $this->calls['latest'] );
			$this->assertSame( array(), $this->calls['ledger'] );
		}
	}

	/**
	 * The oldest get-tickets payments name no purchase: the one whose latest
	 * attempt it is answers, and without one nothing is shown.
	 *
	 * @return void
	 */
	public function test_oldest_get_tickets_payment_uses_its_latest_attempt_only() {
		$metadata = array( 'source' => 'fair-events-get-tickets' );

		$purchases = $this->resolver(
			false,
			array(
				'signups' => array( 7 => self::purchase( 20 ) ),
				'latest'  => array( 7 ),
			)
		)->for_transaction( 12, $metadata );
		$this->assertSame( array( 20 ), TransactionPurchases::summary( $purchases )['ticket_type_ids'] );
		$this->assertSame( array( 12 ), $this->calls['latest'] );

		$purchases = $this->resolver( false, array( 'ledger' => array( self::purchase( 2 ) ) ) )->for_transaction( 12, $metadata );
		$this->assertSame( array(), $purchases );
		$this->assertSame( array(), $this->calls['ledger'] );
	}

	/**
	 * Fair Audience's own routes create one relationship per purchase, so
	 * their payments keep resolving from the ledger before the readers.
	 *
	 * @return void
	 */
	public function test_audience_payment_uses_the_ledger_before_the_readers() {
		$relationship = self::purchase( 5 );

		$purchases = $this->resolver( false, array( 'ledger' => array( $relationship ) ) )->for_transaction(
			33,
			array(
				'source'               => 'fair-audience-signup',
				'event_participant_id' => 4,
			)
		);

		$this->assertSame( array( $relationship ), $purchases );
		$this->assertSame( array(), $this->calls['signups'] );
	}

	/**
	 * Once the readers are active only the payment links answer — even when
	 * there are none, the ledger and the metadata are never read.
	 *
	 * @return void
	 */
	public function test_active_readers_use_payment_links_only() {
		$linked = array( self::purchase( 20 ) );

		$purchases = $this->resolver(
			true,
			array(
				'linked' => $linked,
				'ledger' => array( self::purchase( 2 ) ),
			)
		)->for_transaction(
			80,
			array(
				'source'    => 'fair-events-get-tickets',
				'signup_id' => 82,
			)
		);
		$this->assertSame( $linked, $purchases );

		$purchases = $this->resolver(
			true,
			array(
				'signups' => array( 82 => self::purchase( 2 ) ),
				'ledger'  => array( self::purchase( 2 ) ),
			)
		)->for_transaction(
			80,
			array(
				'source'    => 'fair-events-get-tickets',
				'signup_id' => 82,
			)
		);
		$this->assertSame( array(), $purchases );
		$this->assertSame( array(), $this->calls['signups'] );
		$this->assertSame( array(), $this->calls['ledger'] );
	}

	/**
	 * The event and purchaser are named only when every purchase agrees;
	 * purchases without a ticket type add no label.
	 *
	 * @return void
	 */
	public function test_summary_names_only_what_every_purchase_shares() {
		$summary = TransactionPurchases::summary(
			array(
				self::purchase( 20, 19, 71 ),
				self::purchase( 0, 61, 72 ),
			)
		);

		$this->assertSame(
			array(
				'event_id'        => 0,
				'participant_id'  => 0,
				'ticket_type_ids' => array( 20 ),
			),
			$summary
		);

		$this->assertSame(
			array(
				'event_id'        => 0,
				'participant_id'  => 0,
				'ticket_type_ids' => array(),
			),
			TransactionPurchases::summary( array() )
		);
	}

	/**
	 * Metadata keys: signup_ids wins over signup_id; neither key is null.
	 *
	 * @return void
	 */
	public function test_metadata_signup_ids() {
		$this->assertSame(
			array( 3, 4 ),
			TransactionPurchases::metadata_signup_ids(
				array(
					'signup_ids' => array( 3, 4, 3 ),
					'signup_id'  => 9,
				)
			)
		);
		$this->assertSame( array( 9 ), TransactionPurchases::metadata_signup_ids( array( 'signup_id' => '9' ) ) );
		$this->assertNull( TransactionPurchases::metadata_signup_ids( array( 'source' => 'fair-events-get-tickets' ) ) );
	}
}
