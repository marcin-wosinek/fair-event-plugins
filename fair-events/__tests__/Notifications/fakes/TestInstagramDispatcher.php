<?php
/**
 * TestInstagramDispatcher test double.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Notifications;

use FairEvents\Notifications\InstagramDispatcher;

/**
 * The dispatcher with its locks and queued steps observable.
 */
class TestInstagramDispatcher extends InstagramDispatcher {

	/**
	 * Whether locks are free.
	 *
	 * @var bool
	 */
	public $lock_free = true;

	/**
	 * Delays of queued steps.
	 *
	 * @var int[]
	 */
	public $steps = array();

	/**
	 * Queue a step.
	 *
	 * @param array $job   Job.
	 * @param int   $delay Delay.
	 * @return void
	 */
	protected function schedule_step( array $job, $delay ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.FoundBeforeLastUsed -- only the delay is observed.
		$this->steps[] = $delay;
	}

	/**
	 * Take a lock.
	 *
	 * @param array $job Job.
	 * @return bool
	 */
	protected function lock( array $job ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.Found -- locks are not shared in tests.
		return $this->lock_free;
	}

	/**
	 * Release a lock.
	 *
	 * @param array $job Job.
	 * @return void
	 */
	protected function unlock( array $job ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.Found -- locks are not shared in tests.
	}
}
