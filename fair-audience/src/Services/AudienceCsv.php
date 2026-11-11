<?php
/**
 * Audience CSV codec
 *
 * @package FairAudience
 */

namespace FairAudience\Services;

defined( 'WPINC' ) || die;

/**
 * Reads and writes the audience migration CSV (#2218).
 *
 * The format is RFC 4180: UTF-8 (a leading byte order mark is accepted and
 * written), comma delimited, fields quoted when they contain a comma, quote
 * or line break, and quotes doubled inside quoted fields.
 *
 * Spreadsheet formula protection is reversible: a value starting with
 * `=`, `+`, `-`, `@`, a tab, a carriage return or an apostrophe is written
 * with one extra leading apostrophe, which reading removes again. A value
 * edited in a spreadsheet that drops that apostrophe reads back unchanged.
 *
 * This class only handles the text format. Column meaning and validation
 * live in {@see AudienceMigration}.
 */
class AudienceCsv {

	/**
	 * UTF-8 byte order mark.
	 */
	const BOM = "\xEF\xBB\xBF";

	/**
	 * Characters that make a spreadsheet treat a cell as a formula, plus the
	 * apostrophe used to escape them.
	 */
	const FORMULA_PREFIXES = array( '=', '+', '-', '@', "\t", "\r", "'" );

	/**
	 * Protect a value against spreadsheet formula injection, reversibly.
	 *
	 * @param string $value Raw value.
	 * @return string Value safe to open in a spreadsheet.
	 */
	public static function escape_cell( string $value ): string {
		if ( '' !== $value && in_array( $value[0], self::FORMULA_PREFIXES, true ) ) {
			return "'" . $value;
		}
		return $value;
	}

	/**
	 * Undo {@see self::escape_cell()}.
	 *
	 * Only an apostrophe followed by a protected character is removed, so a
	 * value such as `'Ana` written by hand keeps its apostrophe.
	 *
	 * @param string $value Value read from the file.
	 * @return string Raw value.
	 */
	public static function unescape_cell( string $value ): string {
		if ( strlen( $value ) > 1 && "'" === $value[0] && in_array( $value[1], self::FORMULA_PREFIXES, true ) ) {
			return substr( $value, 1 );
		}
		return $value;
	}

	/**
	 * Serialize rows to CSV text, protecting every cell.
	 *
	 * @param string[]   $header Column names.
	 * @param string[][] $rows   Rows, each a list of values in header order.
	 * @return string CSV text with a byte order mark and CRLF line endings.
	 */
	public static function serialize( array $header, array $rows ): string {
		$lines = array( self::serialize_line( $header ) );
		foreach ( $rows as $row ) {
			$lines[] = self::serialize_line( array_map( array( self::class, 'escape_cell' ), array_map( 'strval', $row ) ) );
		}
		return self::BOM . implode( "\r\n", $lines ) . "\r\n";
	}

	/**
	 * Serialize one record.
	 *
	 * @param string[] $fields Values.
	 * @return string One CSV line, without the line break.
	 */
	private static function serialize_line( array $fields ): string {
		return implode(
			',',
			array_map(
				static function ( $field ) {
					$field = (string) $field;
					if ( '' === $field || ( false === strpbrk( $field, ",\"\r\n" ) && trim( $field ) === $field ) ) {
						return $field;
					}
					return '"' . str_replace( '"', '""', $field ) . '"';
				},
				$fields
			)
		);
	}

	/**
	 * Parse CSV text into records.
	 *
	 * Blank lines are skipped. Cells are returned as written in the file:
	 * formula protection is undone by the caller with
	 * {@see self::unescape_cell()} so it can apply it to data cells only.
	 *
	 * @param string $text CSV text.
	 * @return array{records: array<int, string[]>, error: string|null, line: int|null}
	 *     Records keyed by their 1-based line number in the file; on failure
	 *     `error` is 'encoding' or 'malformed' and `line` names where it was found.
	 */
	public static function parse( string $text ): array {
		if ( 1 !== preg_match( '//u', $text ) ) {
			return array(
				'records' => array(),
				'error'   => 'encoding',
				'line'    => null,
			);
		}

		if ( 0 === strncmp( $text, self::BOM, 3 ) ) {
			$text = substr( $text, 3 );
		}

		$records     = array();
		$record      = array();
		$field       = '';
		$in_quotes   = false;
		$after_quote = false;
		$quoted      = false;
		$line        = 1;
		$record_line = 1;
		$length      = strlen( $text );
		$end_record  = static function () use ( &$records, &$record, &$field, &$quoted, &$record_line ) {
			$record[] = $field;
			if ( ! ( 1 === count( $record ) && '' === $record[0] && ! $quoted ) ) {
				$records[ $record_line ] = $record;
			}
			$record = array();
			$field  = '';
			$quoted = false;
		};
		$malformed   = static function ( $at ) {
			return array(
				'records' => array(),
				'error'   => 'malformed',
				'line'    => $at,
			);
		};

		for ( $i = 0; $i < $length; $i++ ) {
			$char = $text[ $i ];

			if ( $in_quotes ) {
				if ( '"' === $char ) {
					if ( $i + 1 < $length && '"' === $text[ $i + 1 ] ) {
						$field .= '"';
						++$i;
					} else {
						$in_quotes   = false;
						$after_quote = true;
					}
					continue;
				}
				if ( "\n" === $char || ( "\r" === $char && ( $i + 1 >= $length || "\n" !== $text[ $i + 1 ] ) ) ) {
					++$line;
				}
				$field .= $char;
				continue;
			}

			if ( ',' === $char ) {
				$record[]    = $field;
				$field       = '';
				$after_quote = false;
				continue;
			}

			if ( "\r" === $char || "\n" === $char ) {
				if ( "\r" === $char && $i + 1 < $length && "\n" === $text[ $i + 1 ] ) {
					++$i;
				}
				$end_record();
				$after_quote = false;
				++$line;
				$record_line = $line;
				continue;
			}

			if ( $after_quote ) {
				return $malformed( $line );
			}

			if ( '"' === $char ) {
				if ( '' !== $field ) {
					return $malformed( $line );
				}
				$in_quotes = true;
				$quoted    = true;
				continue;
			}

			$field .= $char;
		}

		if ( $in_quotes ) {
			return $malformed( $record_line );
		}

		if ( '' !== $field || $quoted || array() !== $record ) {
			$end_record();
		}

		return array(
			'records' => $records,
			'error'   => null,
			'line'    => null,
		);
	}
}
