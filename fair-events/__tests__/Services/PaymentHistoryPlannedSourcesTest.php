<?php
/**
 * Dry-run attribution tests.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Services;

use FairEvents\Services\PaymentAttribution;
use FairEvents\Services\PaymentHistoryPlannedSources;
use FairEvents\Services\PaymentHistoryPurchasePlanner;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/fakes/attribution-sources.php';

/**
 * In-memory planner: relationship ID => relationship.
 */
class Fake_Purchase_Planner implements PaymentHistoryPurchasePlanner {

	/**
	 * Planned relationships.
	 *
	 * @var array
	 */
	public $planned = array();

	/**
	 * {@inheritDoc}
	 *
	 * @param int $relationship_id ID.
	 * @return array|null
	 */
	public function planned_relationship( $relationship_id ) {
		return $this->planned[ $relationship_id ] ?? null;
	}

	/**
	 * {@inheritDoc}
	 *
	 * @param int $event_date_id  Date.
	 * @param int $participant_id Participant.
	 * @return int[]
	 */
	public function planned_relationships_of( $event_date_id, $participant_id ) {
		$ids = array();
		foreach ( $this->planned as $id => $relationship ) {
			if ( (int) $relationship['event_date_id'] === (int) $event_date_id && (int) $relationship['participant_id'] === (int) $participant_id ) {
				$ids[] = $id;
			}
		}
		return $ids;
	}

	/**
	 * Plan a relationship.
	 *
	 * @param int $id             ID.
	 * @param int $participant_id Participant.
	 * @param int $event_date_id  Date.
	 * @return void
	 */
	public function plan( $id, $participant_id, $event_date_id = 1 ) {
		$this->planned[ $id ] = array(
			'id'             => $id,
			'event_date_id'  => $event_date_id,
			'participant_id' => $participant_id,
		);
	}
}

/**
 * The dry run attributes to the purchases the backfill would create
 * (PAYMENT_HISTORY_MIGRATION.md §8.9), so its conclusions match the
 * backfill's: the same links, with planned purchase IDs, and the same
 * unresolved reasons.
 */
class PaymentHistoryPlannedSourcesTest extends TestCase {

	/**
	 * Real records.
	 *
	 * @var Fake_Attribution_Sources
	 */
	private $sources;

	/**
	 * Planned relationships.
	 *
	 * @var Fake_Purchase_Planner
	 */
	private $planner;

	/**
	 * Fresh records.
	 */
	protected function setUp(): void {
		parent::setUp();
		$this->sources = new Fake_Attribution_Sources();
		$this->planner = new Fake_Purchase_Planner();
	}

	/**
	 * Attribute through the planned sources.
	 *
	 * @param array $metadata   Metadata.
	 * @param mixed $amount     Total.
	 * @param array $line_items Line item totals.
	 * @return array
	 */
	private function attribute( array $metadata, $amount, array $line_items = array() ) {
		$sources = new PaymentHistoryPlannedSources( $this->sources, $this->planner );
		return ( new PaymentAttribution( $sources ) )->attribute(
			array(
				'id'         => 100,
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
	 * Example 3: a legacy admission's Audience purchase links to its
	 * planned purchase with the whole total.
	 */
	public function test_audience_purchase_links_to_planned_purchase(): void {
		$this->sources->relationship( 7, 70 );
		$this->sources->ledger[100] = array(
			array(
				'event_participant_id' => 7,
				'kind'                 => 'charge',
			),
		);
		$this->planner->plan( 7, 70 );

		$result = $this->attribute(
			array(
				'source'               => PaymentAttribution::SOURCE_AUDIENCE,
				'event_participant_id' => 7,
			),
			'20.00'
		);

		$this->assertSame( 'attributed', $result['outcome'] );
		$this->assertSame( -7, $result['links'][0]['signup_id'] );
		$this->assertSame( 20.0, $result['links'][0]['allocated_amount'] );
		$this->assertTrue( PaymentHistoryPlannedSources::is_planned( $result['links'][0]['signup_id'] ) );
	}

	/**
	 * Without a plan, the same transaction has no evidence: the dry run
	 * reports what the backfill would report.
	 */
	public function test_unplanned_relationship_has_no_evidence(): void {
		$this->sources->relationship( 7, 70 );
		$this->sources->ledger[100] = array(
			array(
				'event_participant_id' => 7,
				'kind'                 => 'charge',
			),
		);

		$result = $this->attribute(
			array(
				'source'               => PaymentAttribution::SOURCE_AUDIENCE,
				'event_participant_id' => 7,
			),
			'20.00'
		);

		$this->assertSame( 'unresolved', $result['outcome'] );
		$this->assertSame( 'no_evidence', $result['reason'] );
	}

	/**
	 * Example 20: an Audience multi-instance purchase splits along
	 * identical lines between two planned purchases.
	 */
	public function test_multi_instance_splits_between_planned_purchases(): void {
		$this->sources->relationship( 7, 70, 1 );
		$this->sources->relationship( 8, 70, 2 );
		$this->sources->ledger[100] = array(
			array(
				'event_participant_id' => 7,
				'kind'                 => 'charge',
			),
			array(
				'event_participant_id' => 8,
				'kind'                 => 'charge',
			),
		);
		$this->planner->plan( 7, 70, 1 );
		$this->planner->plan( 8, 70, 2 );

		$result = $this->attribute(
			array(
				'source'                => PaymentAttribution::SOURCE_AUDIENCE,
				'event_participant_ids' => array( 7, 8 ),
			),
			'24.00',
			array( '12.00', '12.00' )
		);

		$this->assertSame( 'attributed', $result['outcome'] );
		$this->assertSame( array( -7, -8 ), array_column( $result['links'], 'signup_id' ) );
		$this->assertSame( array( 12.0, 12.0 ), array_column( $result['links'], 'allocated_amount' ) );
	}

	/**
	 * Example 21: one line for two occurrences stays unresolved.
	 */
	public function test_multi_instance_single_line_is_allocation_mismatch(): void {
		$this->sources->relationship( 7, 70, 1 );
		$this->sources->relationship( 8, 70, 2 );
		$this->sources->ledger[100] = array(
			array(
				'event_participant_id' => 7,
				'kind'                 => 'charge',
			),
			array(
				'event_participant_id' => 8,
				'kind'                 => 'charge',
			),
		);
		$this->planner->plan( 7, 70, 1 );
		$this->planner->plan( 8, 70, 2 );

		$result = $this->attribute(
			array(
				'source'                => PaymentAttribution::SOURCE_AUDIENCE,
				'event_participant_ids' => array( 7, 8 ),
			),
			'24.00',
			array( '24.00' )
		);

		$this->assertSame( 'unresolved', $result['outcome'] );
		$this->assertSame( 'allocation_mismatch', $result['reason'] );
	}

	/**
	 * An add-on without a ticket goes to the participant's single active
	 * purchase, which may be a planned one; a planned and a real purchase
	 * together are two candidates (example 11).
	 */
	public function test_addon_counts_planned_purchases_as_candidates(): void {
		$this->sources->relationship( 7, 70 );
		$this->planner->plan( 7, 70 );
		$metadata = array(
			'source'               => PaymentAttribution::SOURCE_ADDON,
			'event_participant_id' => 7,
		);

		$planned = $this->attribute( $metadata, '8.00' );
		$this->assertSame( 'attributed', $planned['outcome'] );
		$this->assertSame( -7, $planned['links'][0]['signup_id'] );

		// The relationship has no provenance purchase in this world, and a
		// real active purchase sits next to the planned one.
		$this->planner->planned        = array();
		$this->sources->active['1:70'] = array( 41, 42 );
		$ambiguous                     = $this->attribute( $metadata, '8.00' );
		$this->assertSame( 'unresolved', $ambiguous['outcome'] );
		$this->assertSame( 'ambiguous_activity_charge', $ambiguous['reason'] );
	}

	/**
	 * A planned purchase reads as confirmed with no amount yet, on its
	 * relationship's date; real purchases pass through untouched.
	 */
	public function test_signups_include_planned_purchases(): void {
		$this->sources->signup( 5, '15.00' );
		$this->planner->plan( 7, 70, 3 );
		$sources = new PaymentHistoryPlannedSources( $this->sources, $this->planner );

		$signups = $sources->signups( array( 5, -7, -9 ) );

		$this->assertSame( array( 5, -7 ), array_keys( $signups ) );
		$this->assertSame( '15.00', $signups[5]['amount'] );
		$this->assertSame(
			array(
				'id'             => -7,
				'amount'         => '0.00',
				'event_date_id'  => 3,
				'participant_id' => 70,
				'status'         => 'confirmed',
			),
			$signups[-7]
		);
		$this->assertSame( array( -7 ), $sources->active_purchases( 3, 70 ) );
		$this->assertSame( -7, $sources->purchase_for_relationship( 7 ) );
	}

	/**
	 * A real provenance purchase wins over a plan.
	 */
	public function test_real_provenance_purchase_wins(): void {
		$this->sources->provenance[7] = 55;
		$this->planner->plan( 7, 70 );
		$sources = new PaymentHistoryPlannedSources( $this->sources, $this->planner );

		$this->assertSame( 55, $sources->purchase_for_relationship( 7 ) );
	}
}
