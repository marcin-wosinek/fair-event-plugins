<?php
/**
 * Options table double for OneTimeStoreTest.
 *
 * @package FairPlatform
 */

namespace FairPlatform\Tests\OAuth;

/**
 * Minimal options table: insert refuses duplicates, delete reports rows.
 */
class OptionsTableFake {

	/**
	 * Table name.
	 *
	 * @var string
	 */
	public $options = 'wp_options';

	/**
	 * Rows by option name.
	 *
	 * @var array<string,string>
	 */
	public $rows = array();

	/**
	 * Called before a delete, to interleave a concurrent request.
	 *
	 * @var callable|null
	 */
	public $before_delete = null;

	/**
	 * Insert a row.
	 *
	 * @param string $table Table.
	 * @param array  $data  Columns.
	 * @return int|false
	 */
	public function insert( $table, $data ) {
		unset( $table );
		if ( isset( $this->rows[ $data['option_name'] ] ) ) {
			return false;
		}
		$this->rows[ $data['option_name'] ] = $data['option_value'];
		return 1;
	}

	/**
	 * Prepare: keeps the arguments for get_var()/get_col().
	 *
	 * @param string $query Query.
	 * @param mixed  ...$args Arguments.
	 * @return array
	 */
	public function prepare( $query, ...$args ) {
		return array( $query, $args );
	}

	/**
	 * Read one option value.
	 *
	 * @param array $prepared From prepare().
	 * @return string|null
	 */
	public function get_var( $prepared ) {
		$name = $prepared[1][1];
		return $this->rows[ $name ] ?? null;
	}

	/**
	 * Expired option names with a prefix.
	 *
	 * @param array $prepared From prepare().
	 * @return string[]
	 */
	public function get_col( $prepared ) {
		$prefix = str_replace( '\\', '', rtrim( $prepared[1][1], '%' ) );
		$now    = $prepared[1][3];
		$names  = array();
		foreach ( $this->rows as $name => $value ) {
			if ( 0 === strpos( $name, $prefix ) && (int) strtok( $value, '|' ) < $now ) {
				$names[] = $name;
			}
		}
		return $names;
	}

	/**
	 * LIKE escaping.
	 *
	 * @param string $text Text.
	 * @return string
	 */
	public function esc_like( $text ) {
		return addcslashes( $text, '_%\\' );
	}

	/**
	 * Delete a row.
	 *
	 * @param string $table Table.
	 * @param array  $where Where.
	 * @return int
	 */
	public function delete( $table, $where ) {
		unset( $table );
		if ( $this->before_delete ) {
			$callback            = $this->before_delete;
			$this->before_delete = null;
			$callback();
		}
		if ( ! isset( $this->rows[ $where['option_name'] ] ) ) {
			return 0;
		}
		unset( $this->rows[ $where['option_name'] ] );
		return 1;
	}
}
