<?php
/**
 * In-memory stand-in for the two group-rule tables.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Tests\Models;

// phpcs:disable Generic.Commenting.DocComment.MissingShort,Squiz.Commenting.FunctionComment.ParamCommentFullStop,Squiz.Commenting.FunctionComment.MissingParamTag

/**
 * A `$wpdb` fake that answers only the group-rule models' lookups and
 * deletions against rows held per prefixed table name. Setting `$fail`
 * makes every read and delete report a database failure the way `wpdb`
 * does: `null` from `get_row()`/`get_results()`, `false` from `delete()`.
 */
class GroupRuleTablesFake {
	/** @var string */
	public $prefix = 'wp_';
	/** @var array<string, array[]> Rows by prefixed table name. */
	public $tables = array();
	/** @var bool Report database failures. */
	public $fail = false;
	/** @var array[] Queries run: [ sql, args ]. */
	public $queries = array();
	/** @var array[] Deletes run: [ table, where, format ]. */
	public $deletes = array();

	/** @param string $table Unprefixed table. @param array $row Row fields. */
	public function seed( $table, array $row ) {
		$this->tables[ $this->prefix . $table ][] = $row;
	}

	/** @param string $table Unprefixed table. @return array[] */
	public function rows( $table ) {
		return array_values( $this->tables[ $this->prefix . $table ] ?? array() );
	}

	/** @param string $query Query. @param mixed ...$args Arguments. @return array */
	public function prepare( $query, ...$args ) {
		return array( $query, $args );
	}

	/** @param array $prepared Prepared query. @return object|null */
	public function get_row( $prepared ) {
		$rows = $this->select( $prepared );
		return null === $rows ? null : ( $rows[0] ?? null );
	}

	/** @param array $prepared Prepared query. @return object[]|null */
	public function get_results( $prepared ) {
		return $this->select( $prepared );
	}

	/** @param string $table Table. @param array $where Where. @param array $format Formats. @return int|false */
	public function delete( $table, $where, $format ) {
		$this->deletes[] = array( $table, $where, $format );
		if ( $this->fail ) {
			return false;
		}
		$before = count( $this->tables[ $table ] ?? array() );

		$this->tables[ $table ] = array_values(
			array_filter(
				$this->tables[ $table ] ?? array(),
				static function ( $row ) use ( $where ) {
					foreach ( $where as $column => $value ) {
						if ( (int) $row[ $column ] !== (int) $value ) {
							return true;
						}
					}
					return false;
				}
			)
		);

		return $before - count( $this->tables[ $table ] );
	}

	/**
	 * @param array $prepared Prepared query.
	 * @return object[]|null
	 * @throws \LogicException On a query the models never run.
	 */
	private function select( $prepared ) {
		$this->queries[]    = $prepared;
		list( $sql, $args ) = $prepared;
		if ( $this->fail ) {
			return null;
		}

		$table = array_shift( $args );
		if ( 0 === strpos( $sql, 'SELECT * FROM %i WHERE id = %d LIMIT 1' ) ) {
			$filters = array( 'id' => $args[0] );
		} elseif ( 0 === strpos( $sql, 'SELECT * FROM %i WHERE event_date_id = %d AND group_id = %d ORDER BY id ASC' ) ) {
			$filters = array(
				'event_date_id' => $args[0],
				'group_id'      => $args[1],
			);
		} elseif ( 0 === strpos( $sql, 'SELECT * FROM %i WHERE event_date_id = %d ORDER BY id ASC' ) ) {
			$filters = array( 'event_date_id' => $args[0] );
		} else {
			throw new \LogicException( 'Unexpected query: ' . $sql ); // phpcs:ignore WordPress.Security.EscapeOutput.ExceptionNotEscaped -- test-only.
		}

		$rows = array_filter(
			$this->tables[ $table ] ?? array(),
			static function ( $row ) use ( $filters ) {
				foreach ( $filters as $column => $value ) {
					if ( (int) $row[ $column ] !== (int) $value ) {
						return false;
					}
				}
				return true;
			}
		);
		usort(
			$rows,
			static function ( $a, $b ) {
				return (int) $a['id'] <=> (int) $b['id'];
			}
		);

		// wpdb returns string column values as stdClass rows.
		return array_map(
			static function ( $row ) {
				return (object) array_map( 'strval', $row );
			},
			$rows
		);
	}
}
