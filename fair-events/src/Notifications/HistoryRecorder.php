<?php
/**
 * Records one notification execution.
 *
 * @package FairEvents
 */

namespace FairEvents\Notifications;

defined( 'WPINC' ) || die;

/**
 * The history of one execution as one request sees it.
 *
 * Overlapping cron runs of the same scheduled occurrence share one execution
 * row ({@see ExecutionHistory::begin()}). A run speaks for the execution when
 * it created the row, or when it won the occurrence's delivery claim; a run
 * that lost the claim, or found the row already there and recorded no
 * delivery, leaves the result to the run that did the work. Each test
 * request is an execution of its own.
 *
 * Recording never affects sending: without the history tables every call
 * does nothing.
 */
class HistoryRecorder {

	/**
	 * Execution repository.
	 *
	 * @var ExecutionHistory
	 */
	private $history;

	/**
	 * Execution ID, 0 when nothing is recorded.
	 *
	 * @var int
	 */
	private $id;

	/**
	 * Whether this run speaks for the execution.
	 *
	 * @var bool
	 */
	private $owner;

	/**
	 * Whether this run recorded a delivery.
	 *
	 * @var bool
	 */
	private $recorded = false;

	/**
	 * Recipients handed to the mail system without a result yet, keyed by recipient.
	 *
	 * @var array<string, int>
	 */
	private $pending = array();

	/**
	 * Start recording an execution.
	 *
	 * @param ExecutionHistory $history   Execution repository.
	 * @param array            $execution See {@see ExecutionHistory::begin()}.
	 */
	public function __construct( $history, array $execution ) {
		$this->history = $history;
		$begun         = $history->begin( $execution );
		$this->id      = (int) $begun['id'];
		$this->owner   = (bool) $begun['created'];
	}

	/**
	 * Start recording a scheduled send.
	 *
	 * @param ExecutionHistory $history    Execution repository.
	 * @param string           $config_id  Configuration ID.
	 * @param string           $channel    Configuration type.
	 * @param string           $occurrence Week the send was scheduled for.
	 * @param array|null       $week       Covered week, when already known.
	 * @return self
	 */
	public static function scheduled( $history, $config_id, $channel, $occurrence, $week = null ) {
		return new self(
			$history,
			array(
				'config_id'  => $config_id,
				'channel'    => $channel,
				'origin'     => HistoryOutcome::SCHEDULED,
				'occurrence' => $occurrence,
				'week_start' => $week['start'] ?? '',
				'week_end'   => $week['end'] ?? '',
			)
		);
	}

	/**
	 * Start recording a test request.
	 *
	 * @param ExecutionHistory $history   Execution repository.
	 * @param string           $config_id Configuration ID.
	 * @param string           $channel   Configuration type.
	 * @return self
	 */
	public static function test( $history, $config_id, $channel ) {
		return new self(
			$history,
			array(
				'config_id'  => $config_id,
				'channel'    => $channel,
				'origin'     => HistoryOutcome::TEST,
				'occurrence' => '',
			)
		);
	}

	/**
	 * Execution ID, 0 when nothing is recorded.
	 *
	 * @return int
	 */
	public function id() {
		return $this->id;
	}

	/**
	 * This run won the occurrence's delivery claim: the result is its own.
	 *
	 * @return void
	 */
	public function claimed() {
		$this->owner = true;
	}

	/**
	 * Another run holds the occurrence's delivery claim: its result stands.
	 *
	 * @return void
	 */
	public function lost_claim() {
		$this->owner = false;
	}

	/**
	 * Record the covered week once it is known.
	 *
	 * @param array $week Week with 'start' and 'end'.
	 * @return void
	 */
	public function cover( array $week ) {
		if ( $this->owner ) {
			$this->history->cover( $this->id, $week );
		}
	}

	/**
	 * Record a delivery about to be attempted.
	 *
	 * @param string $recipient      Address or chat.
	 * @param int    $part           1-based part, 0 when not split.
	 * @param int    $part_count     Number of parts, 0 when not split.
	 * @param string $recipient_name Recipient's name, when known.
	 * @return int Delivery ID.
	 */
	public function attempt( $recipient, $part = 0, $part_count = 0, $recipient_name = '' ) {
		$this->recorded = true;
		return $this->history->attempt(
			$this->id,
			array(
				'recipient'      => $recipient,
				'recipient_name' => $recipient_name,
				'part'           => $part,
				'part_count'     => $part_count,
			)
		);
	}

	/**
	 * Record an attempted delivery's outcome.
	 *
	 * @param int    $delivery_id Delivery ID.
	 * @param string $outcome     Delivery outcome.
	 * @param string $reason      Safe reason code.
	 * @return void
	 */
	public function settle( $delivery_id, $outcome, $reason = '' ) {
		$this->history->settle( $this->id, $delivery_id, $outcome, $reason );
	}

	/**
	 * Record a delivery that was not attempted.
	 *
	 * @param string $recipient      Address or chat.
	 * @param string $outcome        Skipped or failed.
	 * @param string $reason         Safe reason code.
	 * @param int    $part           1-based part, 0 when not split.
	 * @param int    $part_count     Number of parts, 0 when not split.
	 * @param string $recipient_name Recipient's name, when known.
	 * @return void
	 */
	public function note( $recipient, $outcome, $reason, $part = 0, $part_count = 0, $recipient_name = '' ) {
		$this->recorded = true;
		$this->history->note(
			$this->id,
			array(
				'recipient'      => $recipient,
				'recipient_name' => $recipient_name,
				'part'           => $part,
				'part_count'     => $part_count,
				'outcome'        => $outcome,
				'reason_code'    => $reason,
			)
		);
	}

	/**
	 * Observer for Fair Audience's group email, reporting each recipient as
	 * it is processed, so results recorded so far survive a later failure.
	 *
	 * Events: 'sending' before an email is handed to the mail system, 'sent'
	 * or 'failed' after it, 'rejected' for a recipient that could not be
	 * sent to (e.g. no valid address) and 'skipped' for one excluded (e.g.
	 * without consent). The recipient array has 'id', 'name', 'email' and,
	 * for 'rejected' and 'skipped', a safe 'reason' code.
	 *
	 * @return callable( string, array ): void
	 */
	public function recipient_observer() {
		return function ( $event, array $recipient ) {
			$key     = (string) ( $recipient['id'] ?? '' ) . '|' . (string) ( $recipient['email'] ?? '' );
			$address = (string) ( $recipient['email'] ?? '' );
			$name    = (string) ( $recipient['name'] ?? '' );
			$reason  = (string) ( $recipient['reason'] ?? '' );

			switch ( $event ) {
				case 'sending':
					$this->pending[ $key ] = $this->attempt( $address, 0, 0, $name );
					break;
				case 'sent':
				case 'failed':
					$this->settle( $this->pending[ $key ] ?? 0, 'sent' === $event ? HistoryOutcome::ACCEPTED : HistoryOutcome::FAILED, 'sent' === $event ? '' : 'send_failed' );
					unset( $this->pending[ $key ] );
					break;
				case 'rejected':
					$this->note( $address, HistoryOutcome::FAILED, '' !== $reason ? $reason : 'not_sendable', 0, 0, $name );
					break;
				case 'skipped':
					$this->note( $address, HistoryOutcome::SKIPPED, '' !== $reason ? $reason : 'not_eligible', 0, 0, $name );
					break;
			}
		};
	}

	/**
	 * Give recipients still being sent to when the send stopped a reason.
	 *
	 * Their outcome stays unknown: the email may have gone out.
	 *
	 * @param string $reason Safe reason code.
	 * @return void
	 */
	public function interrupt_pending( $reason ) {
		foreach ( $this->pending as $delivery_id ) {
			$this->settle( $delivery_id, HistoryOutcome::UNKNOWN, $reason );
		}
		$this->pending = array();
	}

	/**
	 * Finish the execution, when this run speaks for it or recorded deliveries.
	 *
	 * @param string $fallback Outcome when there is no delivery.
	 * @param string $reason   Reason code for that outcome.
	 * @return void
	 */
	public function finish( $fallback = HistoryOutcome::SKIPPED, $reason = '' ) {
		if ( $this->owner || $this->recorded ) {
			$this->history->conclude( $this->id, $fallback, $reason );
		}
	}
}
