<?php
/**
 * Minimal fake $wpdb for PHPUnit bootstrap.
 *
 * @package FairEvents
 */

/**
 * Minimal $wpdb double: get_row() resolves to "not found" unless a row was
 * seeded for the exact table + id via seed_row(). Enough for code paths that
 * guard on a null model lookup (e.g. an event_date_id/ticket_type_id of 0)
 * without pulling in a DB library, and for models whose get_by_id() returns
 * the raw row with no hydrate() column contract (e.g. EventSignup). Models
 * with a hydrate() that reads many required columns (EventDates, TicketType)
 * are left unseeded on purpose — see SignupPaymentStateTest's documented
 * convention of keeping those paths out of unit tests.
 */
class Fair_Test_WPDB {

	/**
	 * Table prefix, matching WordPress's default.
	 *
	 * @var string
	 */
	public $prefix = 'wp_';

	/**
	 * Seeded rows, keyed by table name then id.
	 *
	 * @var array<string, array<int, object>>
	 */
	private $rows = array();

	/**
	 * Seeded column lists, keyed by table name then id — backs get_col().
	 *
	 * @var array<string, array<int, array<int>>>
	 */
	private $cols = array();

	/**
	 * Most recent prepared query and arguments.
	 *
	 * @var array{query: string, args: array}|null
	 */
	public $last_prepared = null;

	/**
	 * Most recent update payload.
	 *
	 * @var array|null
	 */
	public $last_update = null;

	/**
	 * Seed a row so get_row() resolves it for the given table + id.
	 *
	 * @param string $table Table name, including prefix (e.g. 'wp_fair_events_signups').
	 * @param int    $id    Row id.
	 * @param object $row   Row to return.
	 * @return void
	 */
	public function seed_row( $table, $id, $row ) {
		$this->rows[ $table ][ $id ] = $row;
	}

	/**
	 * Seed a column list so get_col() resolves it for the given table + id
	 * (e.g. junction-table post ids for `wp_fair_event_date_posts`).
	 *
	 * @param string $table Table name, including prefix.
	 * @param int    $id    Lookup id.
	 * @param array  $values Column values to return.
	 * @return void
	 */
	public function seed_col( $table, $id, array $values ) {
		$this->cols[ $table ][ $id ] = $values;
	}

	/**
	 * Stub of wpdb::prepare() — captures the table + id args this codebase's
	 * `SELECT * FROM %i WHERE id = %d` queries always pass in that order, so
	 * get_row() can resolve them against seeded rows.
	 *
	 * @param string $query   Query with placeholders (ignored).
	 * @param mixed  ...$args Values for the placeholders — [0] table, [1] id.
	 * @return array{table: string|null, id: int|null} Captured lookup key.
	 */
	public function prepare( $query, ...$args ) {
		$this->last_prepared = array(
			'query' => $query,
			'args'  => $args,
		);

		return array(
			'table' => $args[0] ?? null,
			'id'    => isset( $args[1] ) ? (int) $args[1] : null,
			'query' => $query,
			'args'  => $args,
		);
	}

	/**
	 * Capture an update and apply it to a seeded row.
	 *
	 * @param string $table Table name.
	 * @param array  $data  Updated columns.
	 * @param array  $where Row selector.
	 * @return int Always one affected row.
	 */
	public function update( $table, $data, $where ) {
		$this->last_update = compact( 'table', 'data', 'where' );
		$id                = (int) ( $where['id'] ?? 0 );

		if ( isset( $this->rows[ $table ][ $id ] ) ) {
			foreach ( $data as $key => $value ) {
				$this->rows[ $table ][ $id ]->{$key} = $value;
			}
		}

		return 1;
	}

	/**
	 * Execute the pending-signup cleanup against seeded rows.
	 *
	 * @param array $prepared Prepared query capture.
	 * @return int Deleted row count.
	 */
	public function query( $prepared ) {
		$table   = $prepared['args'][0];
		$now     = $prepared['args'][1];
		$deleted = 0;

		foreach ( $this->rows[ $table ] ?? array() as $id => $row ) {
			if ( 'pending_payment' === $row->status && null !== $row->payment_expires_at && $row->payment_expires_at <= $now ) {
				unset( $this->rows[ $table ][ $id ] );
				++$deleted;
			}
		}

		return $deleted;
	}

	/**
	 * Stub of wpdb::get_row() — resolves a prepare()d table/id lookup against
	 * seeded rows, or null when nothing was seeded for it.
	 *
	 * @param array{table: string|null, id: int|null}|mixed $prepared Value returned by prepare().
	 * @return object|null Seeded row, or null.
	 */
	public function get_row( $prepared ) {
		if ( ! is_array( $prepared ) ) {
			return null;
		}
		return $this->rows[ $prepared['table'] ][ $prepared['id'] ] ?? null;
	}

	/**
	 * Stub of wpdb::get_col() — resolves a prepare()d table/id lookup against
	 * values seeded via seed_col(), or an empty array when nothing was seeded.
	 *
	 * @param array{table: string|null, id: int|null}|mixed $prepared Value returned by prepare().
	 * @return array Seeded column values, or an empty array.
	 */
	public function get_col( $prepared ) {
		if ( ! is_array( $prepared ) ) {
			return array();
		}
		return $this->cols[ $prepared['table'] ][ $prepared['id'] ] ?? array();
	}
}
