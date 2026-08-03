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
	 * Stub of wpdb::prepare() — captures the table + id args this codebase's
	 * `SELECT * FROM %i WHERE id = %d` queries always pass in that order, so
	 * get_row() can resolve them against seeded rows.
	 *
	 * @param string $query   Query with placeholders (ignored).
	 * @param mixed  ...$args Values for the placeholders — [0] table, [1] id.
	 * @return array{table: string|null, id: int|null} Captured lookup key.
	 */
	public function prepare( $query, ...$args ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.FoundAfterLastUsed -- query text is irrelevant, only the table/id args matter.
		return array(
			'table' => $args[0] ?? null,
			'id'    => isset( $args[1] ) ? (int) $args[1] : null,
		);
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
}
