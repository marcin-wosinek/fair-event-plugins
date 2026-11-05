<?php
/**
 * Payment attribution rule tests.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Services;

use FairEvents\Services\PaymentAttribution;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/fakes/attribution-sources.php';

/**
 * Attribution follows PAYMENT_HISTORY_MIGRATION.md §5–6: every link comes
 * from allowed evidence, shared totals split only when they add up, and
 * anything else is unresolved with its reason and no partial link.
 */
class PaymentAttributionTest extends TestCase {

	/**
	 * Records.
	 *
	 * @var Fake_Attribution_Sources
	 */
	private $sources;

	/**
	 * Fresh records.
	 */
	protected function setUp(): void {
		parent::setUp();
		$this->sources = new Fake_Attribution_Sources();
	}

	/**
	 * Attribute a transaction.
	 *
	 * @param array $metadata   Metadata.
	 * @param mixed $amount     Total.
	 * @param array $line_items Line item totals.
	 * @param int   $id         Transaction ID.
	 * @return array
	 */
	private function attribute( array $metadata, $amount, array $line_items = array(), $id = 100 ) {
		return ( new PaymentAttribution( $this->sources ) )->attribute(
			array(
				'id'         => $id,
				'amount'     => $amount,
				'currency'   => 'EUR',
				'metadata'   => $metadata,
				'line_items' => array_map(
					static function ( $total ) {
						return array( 'total_amount' => $total );
					},
					$line_items
				),
			)
		);
	}

	/**
	 * Allocations by signup ID.
	 *
	 * @param array $result Result.
	 * @return array
	 */
	private static function allocations( array $result ) {
		$allocations = array();
		foreach ( $result['links'] as $link ) {
			$allocations[ $link['signup_id'] ] = array( $link['role'], $link['allocated_amount'] );
		}
		return $allocations;
	}

	/**
	 * Example 2: a get-tickets transaction naming one purchase gets one
	 * charge link for its whole total.
	 */
	public function test_single_get_tickets_purchase(): void {
		$this->sources->signup( 1, '30.00' );

		$result = $this->attribute(
			array(
				'source'    => 'fair-events-get-tickets',
				'signup_id' => 1,
			),
			'30.00'
		);

		$this->assertSame( 'attributed', $result['outcome'] );
		$this->assertSame( array( 1 => array( 'charge', 30.0 ) ), self::allocations( $result ) );
		$this->assertSame( 'metadata_signup_id', $result['links'][0]['evidence']['type'] );
		$this->assertSame( array(), $result['notes'] );
	}

	/**
	 * §5.3: Connector's total wins for a single purchase, and a different
	 * purchase amount is noted for review.
	 */
	public function test_single_purchase_amount_mismatch_is_noted(): void {
		$this->sources->signup( 1, '25.00' );

		$result = $this->attribute(
			array(
				'source'    => 'fair-events-get-tickets',
				'signup_id' => 1,
			),
			'30.00'
		);

		$this->assertSame( array( 1 => array( 'charge', 30.0 ) ), self::allocations( $result ) );
		$this->assertSame( 'amount_mismatch', $result['notes'][0]['reason'] );
	}

	/**
	 * Example 7: a shared purchase allocates each occurrence its own amount.
	 */
	public function test_shared_purchase_splits_by_signup_amounts(): void {
		foreach ( array( 1, 2, 3 ) as $id ) {
			$this->sources->signup( $id, '12.00' );
		}

		$result = $this->attribute(
			array(
				'source'     => 'fair-events-get-tickets',
				'signup_ids' => array( 1, 2, 3 ),
			),
			'36.00'
		);

		$this->assertSame(
			array(
				1 => array( 'charge', 12.0 ),
				2 => array( 'charge', 12.0 ),
				3 => array( 'charge', 12.0 ),
			),
			self::allocations( $result )
		);
	}

	/**
	 * §5.4: amounts that don't add up to the total produce no link.
	 */
	public function test_shared_purchase_mismatch_is_unresolved(): void {
		$this->sources->signup( 1, '12.00' );
		$this->sources->signup( 2, '10.00' );

		$result = $this->attribute(
			array(
				'source'     => 'fair-events-get-tickets',
				'signup_ids' => array( 1, 2 ),
			),
			'24.00'
		);

		$this->assertSame( 'unresolved', $result['outcome'] );
		$this->assertSame( 'allocation_mismatch', $result['reason'] );
		$this->assertSame( array(), $result['links'] );
	}

	/**
	 * Example 8: a retry is linked with the retry chain in its evidence.
	 */
	public function test_retry_keeps_the_chain(): void {
		$this->sources->signup( 1, '30.00' );

		$result = $this->attribute(
			array(
				'source'                  => 'fair-events-get-tickets',
				'signup_ids'              => array( 1 ),
				'retry_of_transaction_id' => 99,
			),
			'30.00'
		);

		$this->assertSame( 99, $result['links'][0]['evidence']['retry_of_transaction_id'] );
	}

	/**
	 * Example 14: metadata naming a purchase that no longer exists.
	 */
	public function test_missing_purchase_has_no_evidence(): void {
		$result = $this->attribute(
			array(
				'source'    => 'fair-events-get-tickets',
				'signup_id' => 999,
			),
			'30.00'
		);

		$this->assertSame( 'no_evidence', $result['reason'] );
		$this->assertSame( array( 999 ), $result['detail']['missing_signup_ids'] );
	}

	/**
	 * §6.1: the oldest get-tickets transactions resolve through the single
	 * purchase whose latest attempt they are, and only a single one.
	 */
	public function test_oldest_transactions_use_the_latest_attempt(): void {
		$this->sources->signup( 4, '15.00' );
		$this->sources->latest[100] = array( 4 );

		$result = $this->attribute( array( 'source' => 'fair-events-get-tickets' ), '15.00' );
		$this->assertSame( 'signup_latest_transaction', $result['links'][0]['evidence']['type'] );

		$this->sources->signup( 5, '15.00' );
		$this->sources->latest[100] = array( 4, 5 );
		$this->assertSame( 'no_evidence', $this->attribute( array( 'source' => 'fair-events-get-tickets' ), '30.00' )['reason'] );
	}

	/**
	 * Example 3: an Audience purchase resolves through its relationship's
	 * ledger row to the purchase made from that relationship.
	 */
	public function test_audience_purchase_resolves_through_provenance(): void {
		$this->sources->relationship( 10, 500 );
		$this->sources->ledger[100]    = array(
			array(
				'event_participant_id' => 10,
				'kind'                 => 'charge',
			),
		);
		$this->sources->provenance[10] = 7;
		$this->sources->signup( 7, '0.00' );

		$result = $this->attribute(
			array(
				'source'               => 'fair-audience-signup',
				'event_participant_id' => 10,
			),
			'20.00'
		);

		$this->assertSame( array( 7 => array( 'charge', 20.0 ) ), self::allocations( $result ) );
		$this->assertSame( 'audience_signup', $result['links'][0]['evidence']['type'] );
	}

	/**
	 * §6.1: the ledger row must confirm the relationship the metadata names,
	 * and a relationship without a purchase leaves the transaction unresolved.
	 */
	public function test_audience_purchase_needs_ledger_row_and_purchase(): void {
		$this->sources->relationship( 10, 500 );
		$metadata = array(
			'source'               => 'fair-audience-signup',
			'event_participant_id' => 10,
		);

		$this->assertSame( 'no_evidence', $this->attribute( $metadata, '20.00' )['reason'] );

		$this->sources->ledger[100] = array(
			array(
				'event_participant_id' => 10,
				'kind'                 => 'charge',
			),
		);
		$this->assertSame( 'no_evidence', $this->attribute( $metadata, '20.00' )['reason'] );
	}

	/**
	 * Examples 20 and 21: an Audience multi-occurrence purchase splits only
	 * along one identical line item per relationship.
	 */
	public function test_audience_multi_occurrence_splits_identical_lines(): void {
		foreach ( array(
			10 => 7,
			11 => 8,
		) as $relationship_id => $signup_id ) {
			$this->sources->relationship( $relationship_id, 500, $relationship_id );
			$this->sources->provenance[ $relationship_id ] = $signup_id;
			$this->sources->ledger[100][]                  = array(
				'event_participant_id' => $relationship_id,
				'kind'                 => 'charge',
			);
		}
		$metadata = array(
			'source'                => 'fair-audience-signup',
			'event_participant_ids' => array( 10, 11 ),
		);

		$this->assertSame(
			array(
				7 => array( 'charge', 12.0 ),
				8 => array( 'charge', 12.0 ),
			),
			self::allocations( $this->attribute( $metadata, '24.00', array( '12.00', '12.00' ) ) )
		);

		$result = $this->attribute( $metadata, '24.00', array( '24.00' ) );
		$this->assertSame( 'allocation_mismatch', $result['reason'] );
		$this->assertSame( array(), $result['links'] );
	}

	/**
	 * Gap G7: a retry naming one relationship of a multi-occurrence purchase
	 * can't be split.
	 */
	public function test_audience_retry_of_multi_occurrence_is_unresolved(): void {
		$this->sources->relationship( 10, 500 );
		$this->sources->provenance[10] = 7;
		$this->sources->ledger[100]    = array(
			array(
				'event_participant_id' => 10,
				'kind'                 => 'charge',
			),
		);
		$this->sources->metadata[90]   = array( 'event_participant_ids' => array( 10, 11 ) );

		$result = $this->attribute(
			array(
				'source'                  => 'fair-audience-signup',
				'event_participant_id'    => 10,
				'retry_of_transaction_id' => 90,
			),
			'12.00'
		);

		$this->assertSame( 'allocation_mismatch', $result['reason'] );
	}

	/**
	 * Example 10: an add-on naming a ticket is an additional charge on the
	 * purchase owning that ticket.
	 */
	public function test_addon_with_ticket(): void {
		$this->sources->tickets[55] = 3;

		$result = $this->attribute(
			array(
				'source'               => 'fair-audience-activity-addon',
				'event_participant_id' => 10,
				'ticket_id'            => 55,
			),
			'8.00'
		);

		$this->assertSame( array( 3 => array( 'additional_charge', 8.0 ) ), self::allocations( $result ) );
	}

	/**
	 * Example 11: without a ticket, an add-on needs exactly one candidate
	 * purchase.
	 */
	public function test_addon_without_ticket_needs_one_candidate(): void {
		$this->sources->relationship( 10, 500 );
		$metadata = array(
			'source'               => 'fair-audience-activity-addon',
			'event_participant_id' => 10,
			'ticket_id'            => null,
		);

		$this->sources->active['1:500'] = array( 3, 4 );
		$this->assertSame( 'ambiguous_activity_charge', $this->attribute( $metadata, '8.00' )['reason'] );

		$this->sources->active['1:500'] = array( 3 );
		$this->assertSame( array( 3 => array( 'additional_charge', 8.0 ) ), self::allocations( $this->attribute( $metadata, '8.00' ) ) );

		$this->sources->provenance[10] = 9;
		$this->assertSame( array( 9 => array( 'additional_charge', 8.0 ) ), self::allocations( $this->attribute( $metadata, '8.00' ) ) );
	}

	/**
	 * Example 12: a series upgrade is an upgrade link on the relationship's
	 * purchase; with no candidate it is ambiguous.
	 */
	public function test_series_upgrade(): void {
		$metadata = array(
			'source'               => 'fair-audience-series-upgrade',
			'event_participant_id' => 10,
		);
		$this->sources->relationship( 10, 500 );

		$this->assertSame( 'ambiguous_upgrade', $this->attribute( $metadata, '60.00' )['reason'] );

		$this->sources->provenance[10] = 9;
		$this->assertSame( array( 9 => array( 'upgrade', 60.0 ) ), self::allocations( $this->attribute( $metadata, '60.00' ) ) );
	}

	/**
	 * §6.1: an unrecognised source resolves only through a single ledger row
	 * whose relationship has one purchase.
	 */
	public function test_ledger_only_transaction(): void {
		$this->sources->relationship( 10, 500 );
		$this->sources->ledger[100]    = array(
			array(
				'event_participant_id' => 10,
				'kind'                 => 'charge',
			),
		);
		$this->sources->provenance[10] = 9;
		$this->sources->signup( 9, '20.00' );

		$result = $this->attribute( array(), '20.00' );
		$this->assertSame( 'ledger_only', $result['links'][0]['evidence']['type'] );

		$this->sources->relationship( 11, 500 );
		$this->sources->ledger[100][] = array(
			'event_participant_id' => 11,
			'kind'                 => 'charge',
		);
		$this->assertSame( 'no_evidence', $this->attribute( array(), '20.00' )['reason'] );
	}

	/**
	 * §6.2: a transaction recorded against relationships of different
	 * participants is never attributed.
	 */
	public function test_participant_relationship_conflict(): void {
		$this->sources->relationship( 10, 500 );
		$this->sources->relationship( 11, 501 );
		$this->sources->ledger[100] = array(
			array(
				'event_participant_id' => 10,
				'kind'                 => 'charge',
			),
			array(
				'event_participant_id' => 11,
				'kind'                 => 'charge',
			),
		);

		$this->assertSame( 'participant_relationship_conflict', $this->attribute( array( 'source' => 'fair-audience-signup' ), '20.00' )['reason'] );
	}

	/**
	 * §11: participant fee payments, and payments with no event source and
	 * no ledger row, are not event payments.
	 */
	public function test_out_of_scope(): void {
		$this->assertSame( 'out_of_scope', $this->attribute( array( 'fee_payment_id' => 4 ), '10.00' )['outcome'] );
		$this->assertSame( 'out_of_scope', $this->attribute( array( 'source' => 'something-else' ), '10.00' )['outcome'] );
	}
}
