import { todayInTimezone } from '../services/dates.js';

export const sexOptions = [{ value: 'male', label: 'Masculino' }, { value: 'female', label: 'Feminino' }, { value: 'not_informed', label: 'Não informado' }];
export const maritalOptions = [
  { value: 'single', label: 'Solteiro(a)' }, { value: 'married', label: 'Casado(a)' },
  { value: 'divorced', label: 'Divorciado(a)' }, { value: 'widowed', label: 'Viúvo(a)' },
  { value: 'separated', label: 'Separado(a)' }, { value: 'stable_union', label: 'União estável' },
];
export const admissionOptions = [
  { value: 'baptism', label: 'Batismo' }, { value: 'transfer_letter', label: 'Carta de transferência' },
  { value: 'profession_of_faith', label: 'Declaração de Fé' }, { value: 'acclamation', label: 'Aclamação' },
];

export function registrationForm(timezone: string, token = ':token') {
  const base = '/api/cadastro/' + token;
  const asOf = todayInTimezone(timezone);
  return {
    version: 1, title: 'Cadastro de membro da igreja', timezone, asOf,
    frontendPath: '/cadastro/' + token,
    endpoints: { submit: base, cep: base + '/cep/:cep', photo: base + '/foto', calculations: base + '/calculos' },
    defaults: { joinedAt: asOf, children: [] },
    sections: [
      { key: 'personal', label: 'Dados pessoais', fields: [
        { key: 'photoId', label: 'Foto', type: 'photo', required: false, accept: ['image/jpeg', 'image/png', 'image/webp'], maxBytes: 5 * 1024 * 1024 },
        { key: 'name', label: 'Nome', type: 'text', required: true, minLength: 2, maxLength: 120 },
        { key: 'sex', label: 'Sexo', type: 'select', options: sexOptions },
        { key: 'birthDate', label: 'Data de nascimento', type: 'date', max: asOf },
        { key: 'age', label: 'Idade', type: 'computed', readOnly: true, dependsOn: ['birthDate'] },
        { key: 'birthCountry', label: 'País de nascimento', type: 'text', maxLength: 100 },
        { key: 'birthCity', label: 'Cidade de nascimento', type: 'text', maxLength: 100 },
        { key: 'phone', label: 'Número de celular', type: 'tel', maxLength: 40 },
        { key: 'email', label: 'E-mail', type: 'email', maxLength: 254 },
      ] },
      { key: 'address', label: 'Endereço', fields: [
        { key: 'address.postalCode', label: 'CEP', type: 'postal-code', fills: ['address.street', 'address.neighborhood', 'address.city', 'address.state'] },
        { key: 'address.street', label: 'Endereço', type: 'text', maxLength: 160 },
        { key: 'address.number', label: 'Número', type: 'text', maxLength: 20 },
        { key: 'address.complement', label: 'Complemento', type: 'text', maxLength: 100 },
        { key: 'address.neighborhood', label: 'Bairro', type: 'text', maxLength: 100 },
        { key: 'address.city', label: 'Cidade', type: 'text', maxLength: 100 },
        { key: 'address.state', label: 'UF', type: 'text', maxLength: 2 },
      ] },
      { key: 'family', label: 'Família e profissão', fields: [
        { key: 'fatherName', label: 'Nome do pai', type: 'text', maxLength: 120 },
        { key: 'motherName', label: 'Nome da mãe', type: 'text', maxLength: 120 },
        { key: 'profession', label: 'Profissão', type: 'text', maxLength: 120 },
        { key: 'maritalStatus', label: 'Estado civil', type: 'select', options: maritalOptions },
        { key: 'weddingDate', label: 'Data de casamento', type: 'date', max: asOf },
        { key: 'weddingDuration', label: 'Tempo de casado', type: 'computed', readOnly: true, dependsOn: ['weddingDate'] },
        { key: 'spouseName', label: 'Nome do cônjuge', type: 'text', maxLength: 120 },
        { key: 'children', label: 'Filhos', type: 'repeatable', maxItems: 50, fields: [
          { key: 'name', label: 'Nome do filho', type: 'text', required: true, minLength: 2, maxLength: 120 },
          { key: 'birthDate', label: 'Data de nascimento do filho', type: 'date', max: asOf },
          { key: 'age', label: 'Idade do filho', type: 'computed', readOnly: true, dependsOn: ['birthDate'] },
        ] },
      ] },
      { key: 'church', label: 'Histórico na igreja', fields: [
        { key: 'baptismChurch', label: 'Nome da igreja em que foi batizado', type: 'text', maxLength: 160 },
        { key: 'baptismDate', label: 'Data do batismo', type: 'date', max: asOf },
        { key: 'baptismPastor', label: 'Nome do pastor que fez o batismo', type: 'text', maxLength: 120 },
        { key: 'admissionType', label: 'Admitido nesta igreja por', type: 'select', options: admissionOptions },
        { key: 'joinedAt', label: 'Data de entrada', type: 'date', max: asOf },
        { key: 'leftAt', label: 'Data de saída', type: 'date', max: asOf },
      ] },
    ],
  };
}
