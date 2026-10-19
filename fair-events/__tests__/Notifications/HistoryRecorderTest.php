<?php
/**
 * HistoryRecorder tests
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Notifications;

use FairEvents\Notifications\Configurations;
use FairEvents\Notifications\HistoryOutcome;
use FairEvents\Notifications\HistoryRecorder;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/fakes/FakeExecutionHistory.php';

/**
 * Who speaks for an execution, and how group email recipients are recorded.
 */
class HistoryRecorderTest extends TestCase {

	/**
	 * History.
	 *
	 * @var FakeExecutionHistory
	 */
	private $history;

	/**
	 * Set up.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		$this->history = new FakeExecutionHistory();
	}

	/**
	 * A scheduled recorder.
	 *
	 * @return HistoryRecorder
	 */
	private function scheduled() {
		return HistoryRecorder::scheduled( $this->history, 'weekly', Configurations::BULK_EMAIL, '2026-W41' );
	}

	/** Runs of the same occurrence share one execution; each test is its own. */
	public function test_occurrences_share_an_execution_and_tests_do_not() {
		$this->assertSame( $this->scheduled()->id(), $this->scheduled()->id() );

		$first  = HistoryRecorder::test( $this->history, 'weekly', Configurations::BULK_EMAIL );
		$second = HistoryRecorder::test( $this->history, 'weekly', Configurations::BULK_EMAIL );
		$this->assertNotSame( $first->id(), $second->id() );
		$this->assertSame( HistoryOutcome::TEST, $this->history->executions[ $first->id() ]['origin'] );
	}

	/** A later run of the same occurrence cannot overwrite the result with a misleading skip. */
	public function test_repeated_run_does_not_overwrite_with_a_skip() {
		$first    = $this->scheduled();
		$delivery = $first->attempt( 'a@example.test' );
		$first->settle( $delivery, HistoryOutcome::ACCEPTED );
		$first->finish();

		$this->scheduled()->finish( HistoryOutcome::SKIPPED, 'expired' );

		$execution = $this->history->only();
		$this->assertSame( HistoryOutcome::SUCCESS, $execution['outcome'] );
		$this->assertSame( 1, $execution['concluded'] );
	}

	/** A run that lost the delivery claim leaves the result to the winner. */
	public function test_losing_the_claim_leaves_the_result_alone() {
		$creator = $this->scheduled();
		$winner  = $this->scheduled();
		$winner->claimed();
		$creator->lost_claim();

		$creator->finish( HistoryOutcome::SKIPPED, 'already_claimed' );
		$this->assertSame( HistoryOutcome::RUNNING, $this->history->only()['lifecycle'] );

		$winner->finish( HistoryOutcome::SKIPPED, 'no_events' );
		$this->assertSame( 'no_events', $this->history->only()['reason_code'] );
	}

	/** Each recipient is recorded as it is processed, with its safe reason. */
	public function test_recipient_observer_records_each_recipient() {
		$recorder = $this->scheduled();
		$observe  = $recorder->recipient_observer();
		$ann      = array(
			'id'    => 1,
			'name'  => 'Ann',
			'email' => 'ann@example.test',
		);
		$bob      = array(
			'id'    => 2,
			'name'  => 'Bob',
			'email' => 'bob@example.test',
		);

		$observe( 'sending', $ann );
		$observe( 'sent', $ann );
		$observe( 'sending', $bob );
		$observe( 'failed', $bob );
		$observe(
			'skipped',
			array(
				'id'     => 3,
				'name'   => 'Cy',
				'email'  => 'cy@example.test',
				'reason' => 'weekly_summary_opt_out',
			)
		);
		$observe(
			'rejected',
			array(
				'id'     => 4,
				'name'   => 'Di',
				'email'  => '',
				'reason' => 'invalid_address',
			)
		);
		$recorder->finish();

		$deliveries = $this->history->of( $recorder->id() );
		$this->assertSame( array( 'accepted', 'failed', 'skipped', 'failed' ), array_column( $deliveries, 'outcome' ) );
		$this->assertSame( array( '', 'send_failed', 'weekly_summary_opt_out', 'invalid_address' ), array_column( $deliveries, 'reason_code' ) );
		$this->assertSame( array( 'Ann', 'Bob', 'Cy', 'Di' ), array_column( $deliveries, 'recipient_name' ) );
		$this->assertSame( HistoryOutcome::PARTIAL, $this->history->only()['outcome'] );
	}

	/** A recipient being sent to when the send stopped keeps an unknown outcome. */
	public function test_interrupted_recipient_stays_unknown() {
		$recorder = $this->scheduled();
		$observe  = $recorder->recipient_observer();
		$observe(
			'sending',
			array(
				'id'    => 1,
				'name'  => 'Ann',
				'email' => 'ann@example.test',
			)
		);

		$recorder->interrupt_pending( 'internal_error' );
		$recorder->finish( HistoryOutcome::FAILURE, 'internal_error' );

		$execution = $this->history->only();
		$this->assertSame( HistoryOutcome::UNKNOWN, $execution['outcome'] );
		$this->assertSame( 'internal_error', $this->history->of( $recorder->id() )[0]['reason_code'] );
	}
}
