<?php
/**
 * Settlement import steps: cursor history and persistence checkpoints.
 *
 * Each test drives SettlementApiImport::step() over an in-memory repository
 * and the real MollieSettlementProvider on a faked Mollie client, and asserts
 * on the run state a later resume would read.
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Tests\Services;

use PHPUnit\Framework\TestCase;
use FairPaymentsConnector\Payment\MollieSettlementProvider;
use FairPaymentsConnector\Services\SettlementApiImport;
use Mollie\Api\MollieApiClient;
use Mollie\Api\Fake\MockResponse;
use Mollie\Api\Fake\SequenceMockResponse;
use Mollie\Api\Http\Requests\GetPaginatedSettlementPaymentsRequest;
use Mollie\Api\Http\Requests\GetPaginatedSettlementsRequest;
use Fair_Test_Settlement_Repository;
use Fair_Test_Settlement_WPDB;

require_once __DIR__ . '/Fair_Test_Settlement_Repository.php';
require_once __DIR__ . '/Fair_Test_Settlement_WPDB.php';

/**
 * Unit tests for SettlementApiImport steps.
 */
class SettlementApiImportTest extends TestCase {

	/**
	 * Repository.
	 *
	 * @var Fair_Test_Settlement_Repository
	 */
	private $repository;

	/**
	 * Connect Mollie with settlement access before each test.
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_options'] = array(
			'fair_payment_mollie_connected' => true,
			'fair_payment_mollie_scopes'    => array( 'payments.read', 'settlements.read' ),
			'fair_payment_organization_id'  => 'org_unit0001',
		);
		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- test-only fake, no real $wpdb exists here.
		$GLOBALS['wpdb']  = new Fair_Test_Settlement_WPDB();
		$this->repository = new Fair_Test_Settlement_Repository();
	}

	/**
	 * Store a running run with the given state.
	 *
	 * @param array $state Run state.
	 */
	private function seed_run( array $state ) {
		$this->repository->runs[1] = array(
			'id'               => 1,
			'kind'             => SettlementApiImport::KIND_HISTORY,
			'status'           => 'running',
			'account_id'       => 7,
			'organization_id'  => 'org_unit0001',
			'settlement_id'    => null,
			'user_id'          => 1,
			'state'            => wp_json_encode( $state ),
			'settlements_done' => 0,
			'requests_done'    => 0,
			'error_code'       => null,
			'started_at'       => '2026-05-01 10:00:00',
			'updated_at'       => '2026-05-01 10:00:00',
			'finished_at'      => null,
		);
	}

	/**
	 * State of a run that is loading a settlement's payments.
	 *
	 * @param string|null $from Cursor.
	 * @param array|null  $seen Cursor history, or null for a run saved without one.
	 * @return array
	 */
	private function movement_state( $from, $seen ) {
		$current = array(
			'provider_id'   => 'stl_unit0001',
			'settlement_id' => 3,
			'revision_id'   => 5,
			'part'          => 0,
			'from'          => $from,
		);
		if ( null !== $seen ) {
			$current['seen'] = $seen;
		}

		return array(
			'list_from' => null,
			'list_done' => true,
			'queue'     => array(),
			'current'   => $current,
			'skipped'   => 0,
			'counts'    => array(),
		);
	}

	/**
	 * A page of settlement payments.
	 *
	 * @param string      $id   Payment ID.
	 * @param string|null $next Next cursor.
	 * @return MockResponse
	 */
	private function payments_page( $id, $next ) {
		return new MockResponse(
			array(
				'count'     => 1,
				'_embedded' => array(
					'payments' => array(
						array(
							'resource'  => 'payment',
							'id'        => $id,
							'mode'      => 'live',
							'status'    => 'paid',
							'createdAt' => '2026-05-01T10:00:00+00:00',
							'amount'    => array(
								'value'    => '10.00',
								'currency' => 'EUR',
							),
							'_links'    => array(),
						),
					),
				),
				'_links'    => array(
					'next' => $next ? array( 'href' => 'https://api.mollie.com/v2/settlements/stl_unit0001/payments?from=' . $next . '&limit=250' ) : null,
				),
			)
		);
	}

	/**
	 * An import running over the given Mollie responses.
	 *
	 * @param array $responses Request class => response.
	 * @return SettlementApiImport
	 */
	private function import( array $responses ) {
		return new SettlementApiImport( new MollieSettlementProvider( MollieApiClient::fake( $responses ) ), $this->repository );
	}

	/**
	 * The current run state.
	 *
	 * @return array
	 */
	private function state() {
		return json_decode( $this->repository->runs[1]['state'], true );
	}

	/**
	 * A cursor that comes back several pages later is refused, the cursor
	 * stays where it was, and continuing the run refuses it again.
	 */
	public function test_cursor_cycle_over_several_pages_is_refused_and_stays_refused() {
		$this->seed_run( $this->movement_state( null, array() ) );
		$import = $this->import(
			array(
				GetPaginatedSettlementPaymentsRequest::class => new SequenceMockResponse(
					$this->payments_page( 'tr_unit0001', 'tr_unit0002' ),
					$this->payments_page( 'tr_unit0002', 'tr_unit0003' ),
					$this->payments_page( 'tr_unit0003', 'tr_unit0002' ),
					$this->payments_page( 'tr_unit0003', 'tr_unit0002' )
				),
			)
		);

		$import->step( 1 );
		$import->step( 1 );
		$this->assertSame( 'running', $this->repository->runs[1]['status'] );
		$this->assertSame( array( 'tr_unit0002', 'tr_unit0003' ), $this->state()['current']['seen'] );

		$import->step( 1 );

		$run = $this->repository->runs[1];
		$this->assertSame( 'failed', $run['status'] );
		$this->assertSame( 'mollie_invalid_response', $run['error_code'] );
		$this->assertSame( 'tr_unit0003', $this->state()['current']['from'] );
		$this->assertSame( 2, (int) $run['requests_done'] );
		// The refused page was not saved, and nothing was published.
		$this->assertSame( array( 'payment:tr_unit0001#1', 'payment:tr_unit0002#1' ), array_keys( $this->repository->saved ) );

		// The history is part of the saved state, so continuing refuses it again.
		$import->step( 1 );
		$this->assertSame( 'failed', $this->repository->runs[1]['status'] );
		$this->assertSame( 'tr_unit0003', $this->state()['current']['from'] );
	}

	/**
	 * A run saved before cursors were recorded continues, and starts its
	 * history where it stands.
	 */
	public function test_run_saved_without_cursor_history_continues() {
		$this->seed_run( $this->movement_state( 'tr_unit0002', null ) );

		$this->import(
			array( GetPaginatedSettlementPaymentsRequest::class => $this->payments_page( 'tr_unit0002', 'tr_unit0003' ) )
		)->step( 1 );

		$this->assertSame( 'running', $this->repository->runs[1]['status'] );
		$this->assertSame( 'tr_unit0003', $this->state()['current']['from'] );
		$this->assertSame( array( 'tr_unit0003' ), $this->state()['current']['seen'] );
	}

	/** Moving to the next kind of movement starts a fresh cursor history. */
	public function test_last_page_moves_to_the_next_part_with_a_fresh_history() {
		$this->seed_run( $this->movement_state( 'tr_unit0002', array( 'tr_unit0002' ) ) );

		$this->import(
			array( GetPaginatedSettlementPaymentsRequest::class => $this->payments_page( 'tr_unit0002', null ) )
		)->step( 1 );

		$current = $this->state()['current'];
		$this->assertSame( 1, $current['part'] );
		$this->assertNull( $current['from'] );
		$this->assertSame( array(), $current['seen'] );
	}

	/**
	 * When movements cannot be saved, the cursor does not move, so continuing
	 * the run loads the same page again instead of skipping it.
	 */
	public function test_failed_save_keeps_the_cursor_for_a_retry() {
		$this->seed_run( $this->movement_state( 'tr_unit0002', array( 'tr_unit0002' ) ) );
		$this->repository->fail_saves = true;

		$import = $this->import(
			array(
				GetPaginatedSettlementPaymentsRequest::class => new SequenceMockResponse(
					$this->payments_page( 'tr_unit0002', 'tr_unit0003' ),
					$this->payments_page( 'tr_unit0002', 'tr_unit0003' )
				),
			)
		);
		$import->step( 1 );

		$run = $this->repository->runs[1];
		$this->assertSame( 'failed', $run['status'] );
		$this->assertSame( 'not_saved', $run['error_code'] );
		$this->assertSame( 'tr_unit0002', $this->state()['current']['from'] );
		$this->assertSame( array( 'tr_unit0002' ), $this->state()['current']['seen'] );
		$this->assertSame( array( 3, 'not_saved' ), array( $this->repository->settlement_updates[0][0], $this->repository->settlement_updates[0][1]['last_failure_code'] ) );

		$this->repository->fail_saves = false;
		$import->step( 1 );

		$this->assertSame( 'running', $this->repository->runs[1]['status'] );
		$this->assertSame( 'tr_unit0003', $this->state()['current']['from'] );
		$this->assertArrayHasKey( 'payment:tr_unit0002#1', $this->repository->saved );
	}

	/** The settlement listing refuses a cursor it already followed, too. */
	public function test_settlement_list_cycle_is_refused() {
		$this->seed_run(
			array(
				'list_from' => 'stl_unit0003',
				'list_seen' => array( 'stl_unit0002', 'stl_unit0003' ),
				'list_done' => false,
				'queue'     => array(),
				'current'   => null,
				'skipped'   => 0,
				'counts'    => array(),
			)
		);

		$this->import(
			array(
				GetPaginatedSettlementsRequest::class => new MockResponse(
					array(
						'count'     => 0,
						'_embedded' => array( 'settlements' => array() ),
						'_links'    => array( 'next' => array( 'href' => 'https://api.mollie.com/v2/settlements?from=stl_unit0002' ) ),
					)
				),
			)
		)->step( 1 );

		$this->assertSame( 'failed', $this->repository->runs[1]['status'] );
		$this->assertSame( 'mollie_invalid_response', $this->repository->runs[1]['error_code'] );
		$this->assertFalse( $this->state()['list_done'] );
		$this->assertSame( 'stl_unit0003', $this->state()['list_from'] );
	}
}
