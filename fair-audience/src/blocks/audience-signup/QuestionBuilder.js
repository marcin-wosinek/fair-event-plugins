import {
	Button,
	TextControl,
	SelectControl,
	ToggleControl,
	Card,
	CardBody,
	CardHeader,
	Flex,
	FlexItem,
	FlexBlock,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';

const QUESTION_TYPES = [
	{ label: __('Short Text', 'fair-audience'), value: 'short_text' },
	{ label: __('Long Text', 'fair-audience'), value: 'long_text' },
	{ label: __('Number', 'fair-audience'), value: 'number' },
	{ label: __('Date', 'fair-audience'), value: 'date' },
	{ label: __('Select', 'fair-audience'), value: 'select' },
	{ label: __('Radio', 'fair-audience'), value: 'radio' },
	{ label: __('Checkbox', 'fair-audience'), value: 'checkbox' },
];

const TYPES_WITH_OPTIONS = ['radio', 'checkbox', 'select'];

function slugify(text) {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.substring(0, 50);
}

function QuestionBuilder({ questions, onChange }) {
	const updateQuestion = (index, updates) => {
		const updated = questions.map((q, i) =>
			i === index ? { ...q, ...updates } : q
		);
		onChange(updated);
	};

	const addQuestion = () => {
		onChange([
			...questions,
			{
				key: '',
				text: '',
				type: 'short_text',
				required: false,
				options: [],
			},
		]);
	};

	const removeQuestion = (index) => {
		onChange(questions.filter((_, i) => i !== index));
	};

	const moveQuestion = (index, direction) => {
		const newIndex = index + direction;
		if (newIndex < 0 || newIndex >= questions.length) return;
		const updated = [...questions];
		[updated[index], updated[newIndex]] = [
			updated[newIndex],
			updated[index],
		];
		onChange(updated);
	};

	const updateOption = (questionIndex, optionIndex, value) => {
		const updated = [...questions];
		const options = [...updated[questionIndex].options];
		options[optionIndex] = value;
		updated[questionIndex] = { ...updated[questionIndex], options };
		onChange(updated);
	};

	const addOption = (questionIndex) => {
		const updated = [...questions];
		updated[questionIndex] = {
			...updated[questionIndex],
			options: [...updated[questionIndex].options, ''],
		};
		onChange(updated);
	};

	const removeOption = (questionIndex, optionIndex) => {
		const updated = [...questions];
		updated[questionIndex] = {
			...updated[questionIndex],
			options: updated[questionIndex].options.filter(
				(_, i) => i !== optionIndex
			),
		};
		onChange(updated);
	};

	return (
		<div>
			{questions.map((question, index) => (
				<Card key={index} style={{ marginBottom: '12px' }}>
					<CardHeader>
						<Flex>
							<FlexBlock>
								<strong>
									{question.text ||
										__('New Question', 'fair-audience')}
								</strong>
							</FlexBlock>
							<FlexItem>
								<Button
									icon="arrow-up-alt2"
									label={__('Move up', 'fair-audience')}
									onClick={() => moveQuestion(index, -1)}
									disabled={index === 0}
									size="small"
								/>
								<Button
									icon="arrow-down-alt2"
									label={__('Move down', 'fair-audience')}
									onClick={() => moveQuestion(index, 1)}
									disabled={index === questions.length - 1}
									size="small"
								/>
								<Button
									icon="trash"
									label={__('Delete', 'fair-audience')}
									onClick={() => removeQuestion(index)}
									isDestructive
									size="small"
								/>
							</FlexItem>
						</Flex>
					</CardHeader>
					<CardBody>
						<TextControl
							label={__('Question Text', 'fair-audience')}
							value={question.text}
							onChange={(value) => {
								const updates = { text: value };
								if (
									!question.key ||
									question.key === slugify(question.text)
								) {
									updates.key = slugify(value);
								}
								updateQuestion(index, updates);
							}}
						/>
						<TextControl
							label={__('Question Key', 'fair-audience')}
							value={question.key}
							onChange={(value) =>
								updateQuestion(index, { key: slugify(value) })
							}
							help={__(
								'Machine-readable identifier.',
								'fair-audience'
							)}
						/>
						<SelectControl
							label={__('Type', 'fair-audience')}
							value={question.type}
							options={QUESTION_TYPES}
							onChange={(value) =>
								updateQuestion(index, { type: value })
							}
						/>
						<ToggleControl
							label={__('Required', 'fair-audience')}
							checked={question.required}
							onChange={(value) =>
								updateQuestion(index, { required: value })
							}
						/>

						{TYPES_WITH_OPTIONS.includes(question.type) && (
							<div style={{ marginTop: '8px' }}>
								<strong>
									{__('Options', 'fair-audience')}
								</strong>
								{question.options.map((option, optionIndex) => (
									<Flex
										key={optionIndex}
										style={{ marginTop: '4px' }}
									>
										<FlexBlock>
											<TextControl
												value={option}
												onChange={(value) =>
													updateOption(
														index,
														optionIndex,
														value
													)
												}
												placeholder={
													__(
														'Option',
														'fair-audience'
													) + ` ${optionIndex + 1}`
												}
											/>
										</FlexBlock>
										<FlexItem>
											<Button
												icon="no-alt"
												label={__(
													'Remove option',
													'fair-audience'
												)}
												onClick={() =>
													removeOption(
														index,
														optionIndex
													)
												}
												isDestructive
												size="small"
											/>
										</FlexItem>
									</Flex>
								))}
								<Button
									variant="secondary"
									onClick={() => addOption(index)}
									size="small"
									style={{ marginTop: '4px' }}
								>
									{__('Add Option', 'fair-audience')}
								</Button>
							</div>
						)}
					</CardBody>
				</Card>
			))}

			<Button variant="primary" onClick={addQuestion}>
				{__('Add Question', 'fair-audience')}
			</Button>
		</div>
	);
}

export default QuestionBuilder;
