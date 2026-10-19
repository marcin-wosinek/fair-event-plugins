<?php
/**
 * HistoryOutcome tests
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Notifications;

use FairEvents\Notifications\HistoryOutcome;
use PHPUnit\Framework\TestCase;

/**
 * How an execution's outcome follows from its deliveries.
 */
class HistoryOutcomeTest extends TestCase {

	/**
	 * Counts.
	 *
	 * @param int $accepted Accepted.
	 * @param int $failed   Failed.
	 * @param int $skipped  Skipped.
	 * @param int $unknown  Unknown.
	 * @return array
	 */
	private static function counts( $accepted, $failed, $skipped, $unknown ) {
		return array(
			HistoryOutcome::ACCEPTED => $accepted,
			HistoryOutcome::FAILED   => $failed,
			HistoryOutcome::SKIPPED  => $skipped,
			HistoryOutcome::UNKNOWN  => $unknown,
		);
	}

	/**
	 * Mixed cases.
	 *
	 * @return array[]
	 */
	public function cases() {
		return array(
			'all accepted'                        => array( self::counts( 3, 0, 0, 0 ), HistoryOutcome::SUCCESS ),
			'accepted with consent exclusions'    => array( self::counts( 3, 0, 5, 0 ), HistoryOutcome::SUCCESS ),
			'accepted and failed'                 => array( self::counts( 2, 1, 0, 0 ), HistoryOutcome::PARTIAL ),
			'accepted and unknown'                => array( self::counts( 2, 0, 0, 1 ), HistoryOutcome::PARTIAL ),
			'unknown without any accepted'        => array( self::counts( 0, 2, 0, 1 ), HistoryOutcome::UNKNOWN ),
			'failed only'                         => array( self::counts( 0, 2, 0, 0 ), HistoryOutcome::FAILURE ),
			'failed with skipped remaining parts' => array( self::counts( 0, 1, 2, 0 ), HistoryOutcome::FAILURE ),
			'skipped only'                        => array( self::counts( 0, 0, 4, 0 ), HistoryOutcome::SKIPPED ),
			'nothing'                             => array( self::counts( 0, 0, 0, 0 ), HistoryOutcome::SKIPPED ),
		);
	}

	/**
	 * Aggregation.
	 *
	 * @dataProvider cases
	 * @param array  $counts   Counts.
	 * @param string $expected Outcome.
	 */
	public function test_aggregate( array $counts, $expected ) {
		$this->assertSame( $expected, HistoryOutcome::aggregate( $counts ) );
	}

	/** Without deliveries the caller's outcome stands, e.g. a configuration failure. */
	public function test_fallback_applies_only_without_attempts() {
		$this->assertSame( HistoryOutcome::FAILURE, HistoryOutcome::aggregate( self::counts( 0, 0, 0, 0 ), HistoryOutcome::FAILURE ) );
		$this->assertSame( HistoryOutcome::SUCCESS, HistoryOutcome::aggregate( self::counts( 1, 0, 0, 0 ), HistoryOutcome::FAILURE ) );
	}

	/** Provider and delivery record states map to delivery outcomes; anything unsettled is unknown. */
	public function test_from_state() {
		$this->assertSame( HistoryOutcome::ACCEPTED, HistoryOutcome::from_state( 'sent' ) );
		$this->assertSame( HistoryOutcome::FAILED, HistoryOutcome::from_state( 'failed' ) );
		$this->assertSame( HistoryOutcome::SKIPPED, HistoryOutcome::from_state( 'skipped' ) );
		$this->assertSame( HistoryOutcome::UNKNOWN, HistoryOutcome::from_state( 'uncertain' ) );
		$this->assertSame( HistoryOutcome::UNKNOWN, HistoryOutcome::from_state( 'sending' ) );
	}
}
