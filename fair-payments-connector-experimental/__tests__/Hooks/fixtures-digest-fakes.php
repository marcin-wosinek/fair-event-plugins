<?php
/**
 * Test doubles for the digest delivery tests
 *
 * @package FairPaymentsConnectorExperimental
 */

namespace FairPaymentsConnectorExperimental\Tests\Hooks;

use FairPaymentsConnectorExperimental\Services\NotificationQueue;

/**
 * In-memory NotificationQueue that follows the claim rules of the SQL one:
 * ready rows are pending, or sending with a claim older than $stale_before,
 * and a claim is all-or-nothing per group.
 */
class FakeNotificationQueue extends NotificationQueue {

	/**
	 * Queue rows.
	 *
	 * @var object[]
	 */
	public $rows = array();

	/**
	 * Add a row and return it.
	 *
	 * @param array $overrides Column overrides.
	 * @return object
	 */
	public function add( array $overrides = array() ): object {
		$row = (object) array_merge(
			array(
				'id'            => count( $this->rows ) + 1,
				'route_id'      => 'route-a',
				'frequency'     => 'daily',
				'channel'       => 'email',
				'destination'   => 'owner@example.test',
				'rendered_text' => 'Sale',
				'amount'        => '10.00',
				'currency'      => 'EUR',
				'status'        => self::STATUS_PENDING,
				'claim_token'   => '',
				'claimed_at'    => null,
				'attempts'      => 0,
				'last_error'    => '',
				'created_at'    => '2026-09-20 10:00:00',
				'sent_at'       => null,
			),
			$overrides
		);

		$this->rows[] = $row;
		return $row;
	}

	/**
	 * Whether a row can be claimed.
	 *
	 * @param object $row          Row.
	 * @param string $frequency    Frequency.
	 * @param string $stale_before Claims older than this are recoverable.
	 * @return bool
	 */
	private function is_ready( $row, string $frequency, string $stale_before ): bool {
		if ( $row->frequency !== $frequency ) {
			return false;
		}
		return self::STATUS_PENDING === $row->status
			|| ( self::STATUS_SENDING === $row->status && $row->claimed_at < $stale_before );
	}

	/**
	 * Distinct groups with ready rows.
	 *
	 * @param string $frequency    Frequency.
	 * @param string $stale_before Claims older than this are recoverable.
	 * @return object[]
	 */
	public function due_groups( string $frequency, string $stale_before ): array {
		$groups = array();
		foreach ( $this->rows as $row ) {
			if ( $this->is_ready( $row, $frequency, $stale_before ) ) {
				$key            = $row->route_id . '|' . $row->channel . '|' . $row->destination;
				$groups[ $key ] = (object) array(
					'route_id'    => $row->route_id,
					'channel'     => $row->channel,
					'destination' => $row->destination,
				);
			}
		}
		return array_values( $groups );
	}

	/**
	 * Claim a group's ready rows.
	 *
	 * @param object $group        Group.
	 * @param string $frequency    Frequency.
	 * @param string $stale_before Claims older than this are recoverable.
	 * @param string $token        Claim token.
	 * @param string $claimed_at   Claim time.
	 * @return object[]
	 */
	public function claim_group( object $group, string $frequency, string $stale_before, string $token, string $claimed_at ): array {
		$claimed = array();
		foreach ( $this->rows as $row ) {
			if (
				$row->route_id === $group->route_id
				&& $row->channel === $group->channel
				&& $row->destination === $group->destination
				&& $this->is_ready( $row, $frequency, $stale_before )
			) {
				$row->status      = self::STATUS_SENDING;
				$row->claim_token = $token;
				$row->claimed_at  = $claimed_at;
				++$row->attempts;
				$claimed[] = $row;
			}
		}
		return $claimed;
	}

	/**
	 * Mark a claim's rows sent.
	 *
	 * @param string $token   Claim token.
	 * @param string $sent_at Delivery time.
	 * @return void
	 */
	public function mark_sent( string $token, string $sent_at ) {
		foreach ( $this->rows as $row ) {
			if ( $row->claim_token === $token && self::STATUS_SENDING === $row->status ) {
				$row->status      = self::STATUS_SENT;
				$row->sent_at     = $sent_at;
				$row->claim_token = '';
				$row->last_error  = '';
			}
		}
	}

	/**
	 * Return a claim's rows to pending.
	 *
	 * @param string $token Claim token.
	 * @param string $error Failure description.
	 * @return void
	 */
	public function release( string $token, string $error ) {
		foreach ( $this->rows as $row ) {
			if ( $row->claim_token === $token && self::STATUS_SENDING === $row->status ) {
				$row->status      = self::STATUS_PENDING;
				$row->claim_token = '';
				$row->last_error  = $error;
			}
		}
	}
}
