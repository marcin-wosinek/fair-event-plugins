<?php
/**
 * In-memory stand-in for the outbox table, for claim and worker tests.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Tests\Meta;

use FairEventsExperimental\Meta\Outbox;

// phpcs:disable Generic.Commenting.DocComment.MissingShort,Squiz.Commenting.FunctionComment.ParamCommentFullStop,Squiz.Commenting.FunctionComment.MissingParamTag

/**
 * A `$wpdb` fake that answers the outbox's own claim, lease and outcome
 * queries against rows held in memory; it understands only those queries.
 * Writes to other tables, such as the sent-request log, are accepted and
 * recorded without effect.
 */
class OutboxTableFake {
	/** @var string */
	public $prefix = 'wp_';
	/** @var int */
	public $insert_id = 0;
	/** @var array[] Outbox rows by ID. */
	public $rows = array();
	/** @var int Claims another worker wins before this one's next claim. */
	public $steal = 0;
	/** @var string|null Throw from outbox updates with this message. */
	public $fail_update = null;
	/** @var array[] Prepared queries run. */
	public $queries = array();

	/** @param array $overrides Row fields. @return int Row ID. */
	public function add( array $overrides = array() ) {
		$id                = count( $this->rows ) + 1;
		$this->rows[ $id ] = array_merge(
			array(
				'id'               => $id,
				'transaction_id'   => $id,
				'event_post_id'    => null,
				'event_date_id'    => null,
				'event_name'       => 'Purchase',
				'event_id'         => hash( 'sha256', 'row-' . $id ),
				'event_time'       => 1767225600,
				'source_url'       => 'https://example.test/event',
				'value'            => '12.50',
				'currency'         => 'EUR',
				'order_id'         => (string) $id,
				'payment_mode'     => 'live',
				'fbp'              => 'fb.1.1712345678901.browser',
				'fbc'              => null,
				'event_context'    => null,
				'meta_diagnostics' => null,
				'state'            => 'pending',
				'claim_token'      => null,
				'claim_expires_at' => null,
				'attempt_count'    => 0,
				'next_attempt_at'  => '2026-01-01 00:00:00',
				'result_category'  => '',
				'meta_error_code'  => '',
				'meta_error_type'  => '',
			),
			$overrides
		);
		return $id;
	}

	/** @param string $query Query. @param mixed ...$args Arguments. @return array */
	public function prepare( $query, ...$args ) {
		return array( $query, $args );
	}

	/** @param array $prepared Prepared query. @return mixed */
	public function get_var( $prepared ) {
		$this->queries[]    = $prepared;
		list( $sql, $args ) = $prepared;
		if ( false !== strpos( $sql, 'MIN(next_attempt_at)' ) ) {
			return $this->min( 'next_attempt_at', array( 'pending', 'retry_pending' ) );
		}
		if ( false !== strpos( $sql, 'MIN(claim_expires_at)' ) ) {
			return $this->min( 'claim_expires_at', array( 'sending' ) );
		}
		foreach ( $this->sorted() as $row ) {
			if ( false !== strpos( $sql, "state IN ('pending','retry_pending')" ) && $this->due( $row, $args[1] ) ) {
				return $row['id'];
			}
			if ( false !== strpos( $sql, "state = 'sending'" ) && $this->expired( $row, $args[1], $args[2] ) ) {
				return $row['id'];
			}
		}
		return null;
	}

	/** @param array $prepared Prepared query. @return object|null */
	public function get_row( $prepared ) {
		$this->queries[] = $prepared;
		list( , $args )  = $prepared;
		$row             = $this->rows[ $args[1] ] ?? null;
		return $row && $row['claim_token'] === $args[2] ? (object) $row : null;
	}

	/** @param array $prepared Prepared query. @return int */
	public function query( $prepared ) {
		$this->queries[]    = $prepared;
		list( $sql, $args ) = $prepared;
		if ( 0 === strpos( $sql, "UPDATE %i SET state = 'sending'" ) ) {
			list( , $token, $lease, $now, $id, , , $max ) = $args;
			$row = $this->rows[ $id ];
			if ( $this->steal > 0 ) {
				--$this->steal;
				$this->rows[ $id ] = array_merge( $row, $this->claim( $row, 'other-worker', $lease ) );
				return 0;
			}
			if ( ! $this->due( $row, $now ) && ! $this->expired( $row, $now, $max ) ) {
				return 0;
			}
			$this->rows[ $id ] = array_merge( $row, $this->claim( $row, $token, $lease ) );
			return 1;
		}
		if ( 0 === strpos( $sql, "UPDATE %i SET state = 'retries_exhausted'" ) ) {
			$count = 0;
			foreach ( $this->rows as $id => $row ) {
				if ( 'sending' === $row['state'] && null !== $row['claim_expires_at'] && $row['claim_expires_at'] <= $args[2] && $row['attempt_count'] >= $args[3] ) {
					$this->rows[ $id ] = array_merge(
						$row,
						array(
							'state'            => 'retries_exhausted',
							'result_category'  => 'interrupted',
							'meta_error_type'  => 'interrupted',
							'meta_diagnostics' => null,
							'fbp'              => null,
							'fbc'              => null,
							'claim_token'      => null,
							'claim_expires_at' => null,
						)
					);
					++$count;
				}
			}
			return $count;
		}
		return 1;
	}

	/**
	 * @param string $table Table.
	 * @param array  $data  Data.
	 * @param array  $where Where.
	 * @return int
	 * @throws \RuntimeException When told to fail.
	 */
	public function update( $table, $data, $where ) {
		if ( Outbox::table_name() !== $table ) {
			return 1;
		}
		if ( null !== $this->fail_update ) {
			throw new \RuntimeException( $this->fail_update ); // phpcs:ignore WordPress.Security.EscapeOutput.ExceptionNotEscaped -- test fake.
		}
		$row = $this->rows[ $where['id'] ] ?? null;
		if ( ! $row || $row['state'] !== $where['state'] || $row['claim_token'] !== $where['claim_token'] ) {
			return 0;
		}
		$this->rows[ $where['id'] ] = array_merge( $row, $data );
		return 1;
	}

	/** @param string $table Table. @param array $data Data. @return int */
	public function insert( $table, $data ) {
		unset( $table, $data );
		++$this->insert_id;
		return 1;
	}

	/** @return array */
	public function get_results() {
		return array();
	}

	/** @param array $row Row. @param string $token Claim token. @param string $lease Lease end. @return array */
	private function claim( $row, $token, $lease ) {
		return array(
			'state'            => 'sending',
			'claim_token'      => $token,
			'claim_expires_at' => $lease,
			'attempt_count'    => $row['attempt_count'] + 1,
		);
	}

	/** @return array[] Rows in claim order. */
	private function sorted() {
		$rows = array_values( $this->rows );
		usort( $rows, static fn( $a, $b ) => strcmp( $a['next_attempt_at'] . sprintf( '%09d', $a['id'] ), $b['next_attempt_at'] . sprintf( '%09d', $b['id'] ) ) );
		return $rows;
	}

	/** @param array $row Row. @param string $now Now. @return bool */
	private function due( $row, $now ) {
		return in_array( $row['state'], array( 'pending', 'retry_pending' ), true ) && $row['next_attempt_at'] <= $now;
	}

	/** @param array $row Row. @param string $now Now. @param int $max Attempt limit. @return bool */
	private function expired( $row, $now, $max ) {
		return 'sending' === $row['state'] && null !== $row['claim_expires_at'] && $row['claim_expires_at'] <= $now && $row['attempt_count'] < $max;
	}

	/** @param string $column Column. @param string[] $states States. @return string|null */
	private function min( $column, $states ) {
		$values = array();
		foreach ( $this->rows as $row ) {
			if ( in_array( $row['state'], $states, true ) && null !== $row[ $column ] ) {
				$values[] = $row[ $column ];
			}
		}
		return $values ? min( $values ) : null;
	}
}
