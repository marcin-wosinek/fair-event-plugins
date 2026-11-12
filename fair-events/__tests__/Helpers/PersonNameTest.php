<?php
/**
 * Tests for PersonName.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Helpers;

use FairEvents\Helpers\PersonName;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * The complete name of a registrant (#2215).
 */
class PersonNameTest extends TestCase {

	/**
	 * Name components and the complete name they make.
	 *
	 * @return array
	 */
	public static function names_provider(): array {
		return array(
			'name and surname'           => array( 'Ana', 'López', 'Ana López' ),
			'compound name and surname'  => array( 'María José', 'García de la Vega', 'María José García de la Vega' ),
			'no surname'                 => array( 'Prince', '', 'Prince' ),
			'older whole name, verbatim' => array( 'Ana María López', '', 'Ana María López' ),
			'non-Latin script'           => array( '李', '小龙', '李 小龙' ),
			'surrounding spaces'         => array( '  Zoë ', ' Álvarez  ', 'Zoë Álvarez' ),
			'only a surname'             => array( '', 'Okafor', 'Okafor' ),
			'nothing'                    => array( '', '', '' ),
			'null surname'               => array( 'Ada', null, 'Ada' ),
		);
	}

	/**
	 * Joins the components once, without doubled or stray spaces.
	 *
	 * @param string|null $name     Name.
	 * @param string|null $surname  Surname.
	 * @param string      $expected Complete name.
	 */
	#[DataProvider( 'names_provider' )]
	public function test_full_name( $name, $surname, string $expected ): void {
		$this->assertSame( $expected, PersonName::full( $name, $surname ) );
	}

	/**
	 * Reads a signup row, including one stored before the surname existed.
	 */
	public function test_of_signup(): void {
		$this->assertSame(
			'Ada Lovelace',
			PersonName::of_signup(
				(object) array(
					'name'    => 'Ada',
					'surname' => 'Lovelace',
				)
			)
		);
		$this->assertSame( 'Ada Lovelace', PersonName::of_signup( (object) array( 'name' => 'Ada Lovelace' ) ) );
		$this->assertSame(
			'Ada',
			PersonName::of_signup(
				array(
					'name'    => 'Ada',
					'surname' => '',
				)
			)
		);
	}
}
